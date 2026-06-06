/* Obliance VM console helper.
 *
 * Connects to a Hyper-V VM basic console (host 2179 + VM GUID pre-connection
 * blob, SSO/SYSTEM auth, no stored creds), captures the FreeRDP framebuffer,
 * converts BGRA->I420 (FreeRDP primitives) and encodes H.264 Annex-B (libx264).
 *
 * Two output modes (argv[2]):
 *   <file.h264>  : raw Annex-B to a file (playable in ffplay/VLC) — local test.
 *   "-"          : STREAM to stdout using a tiny framed protocol the Go agent
 *                  parses and relays to the ObliReach WS (codec 0x02) + browser:
 *                    msg = [1 byte type] [uint32 LE length] [payload]
 *                    type 'I' (init)  payload = uint32 w, uint32 h
 *                    type 'F' (frame) payload = H.264 Annex-B frame
 *
 * Build (MSYS2 mingw64):
 *   gcc -D__STDC_NO_THREADS__ vmconsole.c -o vmconsole.exe \
 *       $(pkg-config --cflags --libs freerdp3 x264) -lws2_32
 *
 * Run (file):   vmconsole.exe <vm-guid> out.h264 30
 * Run (stream): vmconsole.exe <vm-guid> - 0          (0 = unlimited)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <io.h>
#include <fcntl.h>

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <winpr/synch.h>
#include <winpr/json.h>
#include <freerdp/freerdp.h>
#include <freerdp/gdi/gdi.h>
#include <freerdp/settings.h>
#include <freerdp/codec/color.h>
#include <freerdp/primitives.h>
#include <freerdp/input.h>
#include <x264.h>

typedef struct
{
	rdpContext context;
} vmCtx;

static int g_maxframes = 0; /* 0 = unlimited */
static int g_stream = 0;    /* 1 = framed protocol to stdout, 0 = raw to file */
static FILE* g_out = NULL;
static int g_frames = 0;
static long long g_pts = 0;
static int g_init_sent = 0;

static x264_t* g_enc = NULL;
static x264_picture_t g_picin;
static int g_encw = 0, g_ench = 0;
static primitives_t* g_prims = NULL;

/* ── stream framing ─────────────────────────────────────────────────────── */

static void put_u32le(FILE* f, uint32_t v)
{
	unsigned char b[4] = { (unsigned char)(v), (unsigned char)(v >> 8), (unsigned char)(v >> 16),
		                   (unsigned char)(v >> 24) };
	fwrite(b, 1, 4, f);
}

static void emit_init(int w, int h)
{
	if (!g_stream || g_init_sent)
		return;
	fputc('I', g_out);
	put_u32le(g_out, 8);
	put_u32le(g_out, (uint32_t)w);
	put_u32le(g_out, (uint32_t)h);
	fflush(g_out);
	g_init_sent = 1;
	fprintf(stderr, "init %dx%d\n", w, h);
}

static void emit_frame(const unsigned char* data, int len, int keyframe)
{
	if (g_stream)
	{
		fputc('F', g_out);
		put_u32le(g_out, (uint32_t)len);
		fwrite(data, 1, (size_t)len, g_out);
		fflush(g_out);
	}
	else
	{
		fwrite(data, 1, (size_t)len, g_out);
		printf("frame #%d: %d bytes H.264 (%s)\n", g_frames + 1, len, keyframe ? "KEY" : "delta");
		fflush(stdout);
	}
}

/* ── encoder ────────────────────────────────────────────────────────────── */

static BOOL setup_encoder(int w, int h)
{
	x264_param_t p;
	if (x264_param_default_preset(&p, "ultrafast", "zerolatency") < 0)
		return FALSE;
	p.i_csp = X264_CSP_I420;
	p.i_width = w;
	p.i_height = h;
	p.i_fps_num = 30;
	p.i_fps_den = 1;
	p.i_keyint_max = 60;
	p.b_annexb = 1;
	p.b_repeat_headers = 1;
	p.i_log_level = X264_LOG_NONE;
	if (x264_param_apply_profile(&p, "high") < 0)
		return FALSE;
	g_enc = x264_encoder_open(&p);
	if (!g_enc)
		return FALSE;
	if (x264_picture_alloc(&g_picin, X264_CSP_I420, w, h) < 0)
	{
		x264_encoder_close(g_enc);
		g_enc = NULL;
		return FALSE;
	}
	if (!g_prims)
		g_prims = primitives_get();
	g_encw = w;
	g_ench = h;
	return TRUE;
}

static void close_encoder(void)
{
	if (g_enc)
	{
		x264_picture_clean(&g_picin);
		x264_encoder_close(g_enc);
		g_enc = NULL;
	}
}

static BOOL vm_end_paint(rdpContext* ctx)
{
	rdpGdi* gdi = ctx->gdi;
	if (!gdi || !gdi->primary_buffer)
		return TRUE;
	const int w = (int)gdi->width;
	const int h = (int)gdi->height;

	if (!g_enc || g_encw != w || g_ench != h)
	{
		close_encoder();
		if (!setup_encoder(w, h))
		{
			fprintf(stderr, "encoder setup failed\n");
			return FALSE;
		}
		g_init_sent = 0;
		emit_init(w, h);
	}

	BYTE* dst[3] = { g_picin.img.plane[0], g_picin.img.plane[1], g_picin.img.plane[2] };
	const UINT32 dstStep[3] = { (UINT32)g_picin.img.i_stride[0], (UINT32)g_picin.img.i_stride[1],
		                        (UINT32)g_picin.img.i_stride[2] };
	const prim_size_t roi = { (UINT32)w, (UINT32)h };
	g_prims->RGBToYUV420_8u_P3AC4R(gdi->primary_buffer, gdi->dstFormat, gdi->stride, dst, dstStep, &roi);

	g_picin.i_pts = g_pts++;
	x264_nal_t* nals = NULL;
	int i_nals = 0;
	x264_picture_t pic_out;
	int sz = x264_encoder_encode(g_enc, &nals, &i_nals, &g_picin, &pic_out);
	if (sz > 0)
	{
		emit_frame(nals[0].p_payload, sz, pic_out.b_keyframe);
		g_frames++;
	}

	if (g_maxframes > 0 && g_frames >= g_maxframes)
		freerdp_abort_connect_context(ctx);
	return TRUE;
}

static BOOL vm_post_connect(freerdp* instance)
{
	if (!gdi_init(instance, PIXEL_FORMAT_BGRA32))
		return FALSE;
	instance->context->update->EndPaint = vm_end_paint;
	return TRUE;
}

static BOOL vm_authenticate(freerdp* instance, char** user, char** domain, char** pass)
{
	(void)instance;
	(void)user;
	(void)domain;
	(void)pass;
	return TRUE;
}

static DWORD vm_verify_cert_ex(freerdp* instance, const char* host, UINT16 port,
                               const char* common_name, const char* subject, const char* issuer,
                               const char* fingerprint, DWORD flags)
{
	(void)instance;
	(void)host;
	(void)port;
	(void)common_name;
	(void)subject;
	(void)issuer;
	(void)fingerprint;
	(void)flags;
	return 2;
}

/* ── input injection (browser JSON on stdin -> FreeRDP) ──────────────────── */

static rdpInput* g_input = NULL;

/* DOM KeyboardEvent.code -> PS/2 set-1 scancode (+ extended flag). */
struct kmap
{
	const char* code;
	UINT8 sc;
	BOOL ext;
};
static const struct kmap KMAP[] = {
	{ "Escape", 0x01, 0 }, { "Digit1", 0x02, 0 }, { "Digit2", 0x03, 0 }, { "Digit3", 0x04, 0 },
	{ "Digit4", 0x05, 0 }, { "Digit5", 0x06, 0 }, { "Digit6", 0x07, 0 }, { "Digit7", 0x08, 0 },
	{ "Digit8", 0x09, 0 }, { "Digit9", 0x0A, 0 }, { "Digit0", 0x0B, 0 }, { "Minus", 0x0C, 0 },
	{ "Equal", 0x0D, 0 }, { "Backspace", 0x0E, 0 }, { "Tab", 0x0F, 0 }, { "KeyQ", 0x10, 0 },
	{ "KeyW", 0x11, 0 }, { "KeyE", 0x12, 0 }, { "KeyR", 0x13, 0 }, { "KeyT", 0x14, 0 },
	{ "KeyY", 0x15, 0 }, { "KeyU", 0x16, 0 }, { "KeyI", 0x17, 0 }, { "KeyO", 0x18, 0 },
	{ "KeyP", 0x19, 0 }, { "BracketLeft", 0x1A, 0 }, { "BracketRight", 0x1B, 0 }, { "Enter", 0x1C, 0 },
	{ "ControlLeft", 0x1D, 0 }, { "KeyA", 0x1E, 0 }, { "KeyS", 0x1F, 0 }, { "KeyD", 0x20, 0 },
	{ "KeyF", 0x21, 0 }, { "KeyG", 0x22, 0 }, { "KeyH", 0x23, 0 }, { "KeyJ", 0x24, 0 },
	{ "KeyK", 0x25, 0 }, { "KeyL", 0x26, 0 }, { "Semicolon", 0x27, 0 }, { "Quote", 0x28, 0 },
	{ "Backquote", 0x29, 0 }, { "ShiftLeft", 0x2A, 0 }, { "Backslash", 0x2B, 0 }, { "KeyZ", 0x2C, 0 },
	{ "KeyX", 0x2D, 0 }, { "KeyC", 0x2E, 0 }, { "KeyV", 0x2F, 0 }, { "KeyB", 0x30, 0 },
	{ "KeyN", 0x31, 0 }, { "KeyM", 0x32, 0 }, { "Comma", 0x33, 0 }, { "Period", 0x34, 0 },
	{ "Slash", 0x35, 0 }, { "ShiftRight", 0x36, 0 }, { "NumpadMultiply", 0x37, 0 }, { "AltLeft", 0x38, 0 },
	{ "Space", 0x39, 0 }, { "CapsLock", 0x3A, 0 }, { "F1", 0x3B, 0 }, { "F2", 0x3C, 0 }, { "F3", 0x3D, 0 },
	{ "F4", 0x3E, 0 }, { "F5", 0x3F, 0 }, { "F6", 0x40, 0 }, { "F7", 0x41, 0 }, { "F8", 0x42, 0 },
	{ "F9", 0x43, 0 }, { "F10", 0x44, 0 }, { "NumLock", 0x45, 0 }, { "ScrollLock", 0x46, 0 },
	{ "Numpad7", 0x47, 0 }, { "Numpad8", 0x48, 0 }, { "Numpad9", 0x49, 0 }, { "NumpadSubtract", 0x4A, 0 },
	{ "Numpad4", 0x4B, 0 }, { "Numpad5", 0x4C, 0 }, { "Numpad6", 0x4D, 0 }, { "NumpadAdd", 0x4E, 0 },
	{ "Numpad1", 0x4F, 0 }, { "Numpad2", 0x50, 0 }, { "Numpad3", 0x51, 0 }, { "Numpad0", 0x52, 0 },
	{ "NumpadDecimal", 0x53, 0 }, { "F11", 0x57, 0 }, { "F12", 0x58, 0 },
	/* extended (0xE0-prefixed) */
	{ "ControlRight", 0x1D, 1 }, { "AltRight", 0x38, 1 }, { "NumpadEnter", 0x1C, 1 },
	{ "NumpadDivide", 0x35, 1 }, { "Insert", 0x52, 1 }, { "Delete", 0x53, 1 }, { "Home", 0x47, 1 },
	{ "End", 0x4F, 1 }, { "PageUp", 0x49, 1 }, { "PageDown", 0x51, 1 }, { "ArrowUp", 0x48, 1 },
	{ "ArrowLeft", 0x4B, 1 }, { "ArrowRight", 0x4D, 1 }, { "ArrowDown", 0x50, 1 }, { "MetaLeft", 0x5B, 1 },
	{ "MetaRight", 0x5C, 1 }, { "ContextMenu", 0x5D, 1 }, { NULL, 0, 0 },
};

static BOOL code_to_sc(const char* code, UINT8* sc, BOOL* ext)
{
	for (int i = 0; KMAP[i].code; i++)
		if (strcmp(KMAP[i].code, code) == 0)
		{
			*sc = KMAP[i].sc;
			*ext = KMAP[i].ext;
			return TRUE;
		}
	return FALSE;
}

static int json_int(WINPR_JSON* o, const char* k)
{
	WINPR_JSON* it = WINPR_JSON_GetObjectItem(o, k);
	return it ? (int)WINPR_JSON_GetNumberValue(it) : 0;
}
static const char* json_str(WINPR_JSON* o, const char* k)
{
	WINPR_JSON* it = WINPR_JSON_GetObjectItem(o, k);
	return (it && WINPR_JSON_IsString(it)) ? WINPR_JSON_GetStringValue(it) : NULL;
}

static void inject_mouse(WINPR_JSON* o, const char* action)
{
	if (!g_input)
		return;
	UINT16 x = (UINT16)json_int(o, "x"), y = (UINT16)json_int(o, "y");
	if (strcmp(action, "move") == 0)
		freerdp_input_send_mouse_event(g_input, PTR_FLAGS_MOVE, x, y);
	else if (strcmp(action, "scroll") == 0)
	{
		UINT16 f = PTR_FLAGS_WHEEL | (UINT16)(0x78 & WheelRotationMask);
		if (json_int(o, "delta") < 0)
			f |= PTR_FLAGS_WHEEL_NEGATIVE;
		freerdp_input_send_mouse_event(g_input, f, x, y);
	}
	else
	{
		int button = json_int(o, "button");
		UINT16 bf = (button == 2) ? PTR_FLAGS_BUTTON2 : (button == 1) ? PTR_FLAGS_BUTTON3 : PTR_FLAGS_BUTTON1;
		UINT16 f = bf | (strcmp(action, "down") == 0 ? PTR_FLAGS_DOWN : 0);
		freerdp_input_send_mouse_event(g_input, f, x, y);
	}
}

static void inject_key(WINPR_JSON* o, const char* action)
{
	if (!g_input)
		return;
	BOOL down = (strcmp(action, "down") == 0);
	const char* code = json_str(o, "code");
	UINT8 sc;
	BOOL ext;
	if (code && code_to_sc(code, &sc, &ext))
	{
		UINT16 f = (down ? KBD_FLAGS_DOWN : KBD_FLAGS_RELEASE) | (ext ? KBD_FLAGS_EXTENDED : 0);
		freerdp_input_send_keyboard_event(g_input, f, sc);
		return;
	}
	const char* key = json_str(o, "key"); /* printable fallback */
	if (key && key[0] && key[1] == '\0')
		freerdp_input_send_unicode_keyboard_event(g_input, down ? 0 : KBD_FLAGS_RELEASE,
		                                          (UINT16)(unsigned char)key[0]);
}

static DWORD WINAPI stdin_thread(LPVOID arg)
{
	(void)arg;
	char line[4096];
	while (fgets(line, sizeof(line), stdin))
	{
		WINPR_JSON* o = WINPR_JSON_Parse(line);
		if (!o)
			continue;
		const char* type = json_str(o, "type");
		const char* action = json_str(o, "action");
		if (type && action)
		{
			if (strcmp(type, "mouse") == 0)
				inject_mouse(o, action);
			else if (strcmp(type, "key") == 0)
				inject_key(o, action);
		}
		WINPR_JSON_Delete(o);
	}
	return 0;
}

int main(int argc, char** argv)
{
	if (argc < 2)
	{
		fprintf(stderr, "usage: vmconsole <vm-guid> [out.h264|-] [maxframes] [host]\n");
		return 2;
	}
	const char* guid = argv[1];
	const char* out = (argc > 2) ? argv[2] : "out.h264";
	if (argc > 3)
		g_maxframes = atoi(argv[3]);
	const char* host = (argc > 4) ? argv[4] : "127.0.0.1";

	WSADATA wsaData;
	if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0)
	{
		fprintf(stderr, "WSAStartup failed\n");
		return 5;
	}

	if (strcmp(out, "-") == 0)
	{
		g_stream = 1;
		g_out = stdout;
		_setmode(_fileno(stdout), _O_BINARY); /* no CRLF translation on the byte stream */
	}
	else
	{
		g_out = fopen(out, "wb");
		if (!g_out)
		{
			fprintf(stderr, "cannot open output %s\n", out);
			return 6;
		}
		if (g_maxframes <= 0)
			g_maxframes = 1; /* file mode: default capture one frame */
	}

	freerdp* instance = freerdp_new();
	if (!instance)
		return 3;
	instance->ContextSize = sizeof(vmCtx);
	instance->PostConnect = vm_post_connect;
	instance->Authenticate = vm_authenticate;
	instance->VerifyCertificateEx = vm_verify_cert_ex;

	if (!freerdp_context_new(instance))
	{
		freerdp_free(instance);
		return 3;
	}

	rdpSettings* s = instance->context->settings;
	freerdp_settings_set_string(s, FreeRDP_ServerHostname, host);
	freerdp_settings_set_uint32(s, FreeRDP_ServerPort, 2179);
	freerdp_settings_set_bool(s, FreeRDP_VmConnectMode, TRUE);
	freerdp_settings_set_string(s, FreeRDP_PreconnectionBlob, guid);
	freerdp_settings_set_bool(s, FreeRDP_SendPreconnectionPdu, TRUE);
	freerdp_settings_set_bool(s, FreeRDP_IgnoreCertificate, TRUE);
	freerdp_settings_set_bool(s, FreeRDP_NlaSecurity, TRUE);
	freerdp_settings_set_bool(s, FreeRDP_TlsSecurity, TRUE);
	freerdp_settings_set_bool(s, FreeRDP_NegotiateSecurityLayer, FALSE);

	{
		const char* u = getenv("FRDP_USER");
		const char* p = getenv("FRDP_PASS");
		const char* d = getenv("FRDP_DOMAIN");
		if (u && *u)
			freerdp_settings_set_string(s, FreeRDP_Username, u);
		if (p && *p)
			freerdp_settings_set_string(s, FreeRDP_Password, p);
		if (d && *d)
			freerdp_settings_set_string(s, FreeRDP_Domain, d);
	}

	if (!freerdp_connect(instance))
	{
		fprintf(stderr, "CONNECT FAILED: 0x%08x\n", freerdp_get_last_error(instance->context));
		close_encoder();
		if (g_out && g_out != stdout)
			fclose(g_out);
		freerdp_context_free(instance);
		freerdp_free(instance);
		return 4;
	}

	/* Interactive input: in stream mode, the agent relays browser keyboard/mouse
	 * JSON to our stdin. Inject from a reader thread (GUI FreeRDP clients send
	 * input from a separate thread too). */
	g_input = instance->context->input;
	if (g_stream)
	{
		HANDLE th = CreateThread(NULL, 0, stdin_thread, NULL, 0, NULL);
		if (th)
			CloseHandle(th);
	}

	while (!freerdp_shall_disconnect_context(instance->context))
	{
		HANDLE handles[64];
		DWORD n = freerdp_get_event_handles(instance->context, handles, 64);
		if (n == 0)
			break;
		if (WaitForMultipleObjects(n, handles, FALSE, 5000) == WAIT_FAILED)
			break;
		if (!freerdp_check_event_handles(instance->context))
			break;
	}

	freerdp_disconnect(instance);
	close_encoder();
	if (g_out && g_out != stdout)
		fclose(g_out);
	freerdp_context_free(instance);
	freerdp_free(instance);
	if (!g_stream)
		fprintf(stderr, "DONE — %d H.264 frame(s) -> %s\n", g_frames, out);
	return 0;
}
