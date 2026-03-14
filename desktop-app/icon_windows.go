//go:build windows

package main

/*
#include <windows.h>

// Load the embedded icon resource (IDI_ICON1 = 1) and apply it to the
// webview window so it shows in the title bar and the taskbar.
static void apply_window_icon(void *hwnd_vp) {
	HWND hwnd = (HWND)hwnd_vp;
	if (!hwnd) return;

	HINSTANCE hInst = GetModuleHandle(NULL);

	// Big icon  — used by the taskbar and Alt+Tab switcher
	HICON big = (HICON)LoadImage(
		hInst, MAKEINTRESOURCE(1), IMAGE_ICON,
		GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON),
		LR_DEFAULTCOLOR);

	// Small icon — shown in the window title bar (top-left corner)
	HICON small = (HICON)LoadImage(
		hInst, MAKEINTRESOURCE(1), IMAGE_ICON,
		GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON),
		LR_DEFAULTCOLOR);

	if (big)   SendMessage(hwnd, WM_SETICON, ICON_BIG,   (LPARAM)big);
	if (small) SendMessage(hwnd, WM_SETICON, ICON_SMALL, (LPARAM)small);
}
*/
import "C"
import "unsafe"

func applyWindowIcon(nativeHandle unsafe.Pointer) {
	C.apply_window_icon(nativeHandle)
}
