//go:build windows

package main

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ── Windows GDI screen capture ───────────────────────────────────────────────

var (
	libUser32 = windows.NewLazySystemDLL("user32.dll")
	libGdi32  = windows.NewLazySystemDLL("gdi32.dll")

	procGetDesktopWindow       = libUser32.NewProc("GetDesktopWindow")
	procGetDC                  = libUser32.NewProc("GetDC")
	procReleaseDC              = libUser32.NewProc("ReleaseDC")
	procGetSystemMetrics       = libUser32.NewProc("GetSystemMetrics")
	procCreateCompatibleDC     = libGdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = libGdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject           = libGdi32.NewProc("SelectObject")
	procBitBlt                 = libGdi32.NewProc("BitBlt")
	procGetDIBits              = libGdi32.NewProc("GetDIBits")
	procDeleteObject           = libGdi32.NewProc("DeleteObject")
	procDeleteDC               = libGdi32.NewProc("DeleteDC")
	procSendInput              = libUser32.NewProc("SendInput")
	procSetCursorPos           = libUser32.NewProc("SetCursorPos")
	procMapVirtualKey          = libUser32.NewProc("MapVirtualKeyW")
)

const (
	smCXScreen   = 0
	smCYScreen   = 1
	srcCopy      = 0x00CC0020
	dibRGBColors = 0
	biRGB        = 0
)

// bitmapInfoHeader mirrors the WIN32 BITMAPINFOHEADER struct.
type bitmapInfoHeader struct {
	BiSize          uint32
	BiWidth         int32
	BiHeight        int32
	BiPlanes        uint16
	BiBitCount      uint16
	BiCompression   uint32
	BiSizeImage     uint32
	BiXPelsPerMeter int32
	BiYPelsPerMeter int32
	BiClrUsed       uint32
	BiClrImportant  uint32
}

type bitmapInfo struct {
	BmiHeader bitmapInfoHeader
	BmiColors [1]uint32
}

// orScreenSize returns the primary monitor resolution via GetSystemMetrics.
func orScreenSize() (int, int, error) {
	w, _, _ := procGetSystemMetrics.Call(smCXScreen)
	h, _, _ := procGetSystemMetrics.Call(smCYScreen)
	if w == 0 || h == 0 {
		return 0, 0, fmt.Errorf("GetSystemMetrics returned zero dimensions")
	}
	return int(w), int(h), nil
}

// orDefaultFPS returns the capture frame rate (15 FPS default).
func orDefaultFPS() int { return 15 }

// orCaptureJPEG captures the full virtual desktop and encodes it as JPEG.
func orCaptureJPEG() ([]byte, error) {
	width, height, err := orScreenSize()
	if err != nil {
		return nil, err
	}

	hwnd, _, _ := procGetDesktopWindow.Call()
	hdc, _, _ := procGetDC.Call(hwnd)
	if hdc == 0 {
		return nil, fmt.Errorf("GetDC failed")
	}
	defer procReleaseDC.Call(hwnd, hdc)

	hdcMem, _, _ := procCreateCompatibleDC.Call(hdc)
	if hdcMem == 0 {
		return nil, fmt.Errorf("CreateCompatibleDC failed")
	}
	defer procDeleteDC.Call(hdcMem)

	hbmp, _, _ := procCreateCompatibleBitmap.Call(hdc, uintptr(width), uintptr(height))
	if hbmp == 0 {
		return nil, fmt.Errorf("CreateCompatibleBitmap failed")
	}
	defer procDeleteObject.Call(hbmp)

	procSelectObject.Call(hdcMem, hbmp)

	ret, _, _ := procBitBlt.Call(
		hdcMem, 0, 0, uintptr(width), uintptr(height),
		hdc, 0, 0, srcCopy,
	)
	if ret == 0 {
		return nil, fmt.Errorf("BitBlt failed")
	}

	// Allocate pixel buffer: 4 bytes per pixel (BGRA)
	buf := make([]byte, width*height*4)

	bmi := bitmapInfo{
		BmiHeader: bitmapInfoHeader{
			BiSize:        uint32(unsafe.Sizeof(bitmapInfoHeader{})),
			BiWidth:       int32(width),
			BiHeight:      -int32(height), // negative = top-down DIB
			BiPlanes:      1,
			BiBitCount:    32,
			BiCompression: biRGB,
		},
	}

	ret, _, _ = procGetDIBits.Call(
		hdcMem, hbmp,
		0, uintptr(height),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&bmi)),
		dibRGBColors,
	)
	if ret == 0 {
		return nil, fmt.Errorf("GetDIBits failed")
	}

	// Convert BGRA → RGBA in-place (swap R and B channels)
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	pix := img.Pix
	for i := 0; i < len(buf); i += 4 {
		pix[i+0] = buf[i+2] // R ← B
		pix[i+1] = buf[i+1] // G
		pix[i+2] = buf[i+0] // B ← R
		pix[i+3] = 0xFF     // A = opaque
	}

	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: 65}); err != nil {
		return nil, fmt.Errorf("jpeg encode: %w", err)
	}
	return out.Bytes(), nil
}

// Suppress unused import warning for color package.
var _ = color.RGBA{}

// ── Windows input injection ───────────────────────────────────────────────────

const (
	inputMouse    = 0
	inputKeyboard = 1

	// Mouse event flags
	mouseeventfMove       = 0x0001
	mouseeventfLeftDown   = 0x0002
	mouseeventfLeftUp     = 0x0004
	mouseeventfRightDown  = 0x0008
	mouseeventfRightUp    = 0x0010
	mouseeventfMiddleDown = 0x0020
	mouseeventfMiddleUp   = 0x0040
	mouseeventfWheel      = 0x0800
	mouseeventfAbsolute   = 0x8000

	// Keyboard event flags
	keyeventfKeyUp  = 0x0002
	keyeventfUnicode = 0x0004
)

// INPUT structure layout (must match Win32 INPUT exactly).
// We use a fixed-size byte array for the union (MOUSEINPUT is the largest at 28 bytes).
type inputUnion [28]byte
type winInput struct {
	Type  uint32
	_     uint32 // alignment padding on 64-bit
	Union inputUnion
}

// mouseInput packs a MOUSEINPUT into inputUnion bytes.
// dx, dy in absolute coordinates (0–65535 mapped to screen).
func mouseInput(dx, dy int32, dwFlags, mouseData uint32) winInput {
	inp := winInput{Type: inputMouse}
	*(*int32)(unsafe.Pointer(&inp.Union[0])) = dx
	*(*int32)(unsafe.Pointer(&inp.Union[4])) = dy
	*(*uint32)(unsafe.Pointer(&inp.Union[8])) = mouseData
	*(*uint32)(unsafe.Pointer(&inp.Union[12])) = dwFlags
	return inp
}

// keyInput packs a KEYBDINPUT into inputUnion bytes.
func keyInput(vk uint16, dwFlags uint32) winInput {
	inp := winInput{Type: inputKeyboard}
	*(*uint16)(unsafe.Pointer(&inp.Union[0])) = vk // wVk
	return inp
}
func keyInputWithFlags(vk uint16, dwFlags uint32) winInput {
	inp := winInput{Type: inputKeyboard}
	*(*uint16)(unsafe.Pointer(&inp.Union[0])) = vk
	*(*uint32)(unsafe.Pointer(&inp.Union[4])) = dwFlags
	return inp
}

func sendInputs(inputs []winInput) {
	if len(inputs) == 0 {
		return
	}
	procSendInput.Call(
		uintptr(len(inputs)),
		uintptr(unsafe.Pointer(&inputs[0])),
		unsafe.Sizeof(inputs[0]),
	)
}

// screenW, screenH are cached after first capture.
var (
	cachedScreenW, cachedScreenH int
)

func getScreenDims() (int, int) {
	if cachedScreenW == 0 {
		w, _, _ := procGetSystemMetrics.Call(smCXScreen)
		h, _, _ := procGetSystemMetrics.Call(smCYScreen)
		cachedScreenW, cachedScreenH = int(w), int(h)
	}
	return cachedScreenW, cachedScreenH
}

// toAbsolute converts pixel coordinates to the 0–65535 range that
// MOUSEEVENTF_ABSOLUTE requires.
func toAbsolute(x, y int) (int32, int32) {
	w, h := getScreenDims()
	if w == 0 || h == 0 {
		return 0, 0
	}
	ax := int32((x * 65535) / w)
	ay := int32((y * 65535) / h)
	return ax, ay
}

// orInjectMouse translates a browser mouse event into a Win32 SendInput call.
func orInjectMouse(msg orInputMsg) {
	ax, ay := toAbsolute(msg.X, msg.Y)
	flags := uint32(mouseeventfAbsolute | mouseeventfMove)
	mouseData := uint32(0)

	switch msg.Action {
	case "move":
		sendInputs([]winInput{mouseInput(ax, ay, flags, 0)})
		return
	case "down":
		switch msg.Button {
		case 1:
			flags |= mouseeventfLeftDown
		case 2:
			flags |= mouseeventfMiddleDown
		case 3:
			flags |= mouseeventfRightDown
		default:
			return
		}
	case "up":
		switch msg.Button {
		case 1:
			flags |= mouseeventfLeftUp
		case 2:
			flags |= mouseeventfMiddleUp
		case 3:
			flags |= mouseeventfRightUp
		default:
			return
		}
	case "scroll":
		flags = mouseeventfAbsolute | mouseeventfWheel
		// delta is in lines; Windows WHEEL_DELTA = 120 per notch
		lines := int32(msg.Delta)
		if lines == 0 {
			if msg.Delta < 0 {
				lines = -1
			} else {
				lines = 1
			}
		}
		mouseData = uint32(lines * -120) // negative = scroll down
	default:
		return
	}

	sendInputs([]winInput{mouseInput(ax, ay, flags, mouseData)})
}

// orInjectKey translates a browser KeyboardEvent.code string to a Win32 VK
// code and calls SendInput.
func orInjectKey(msg orInputMsg) {
	vk, ok := jsCodeToVK[msg.Code]
	if !ok {
		return
	}

	modDown, modUp := buildModifiers(msg)

	var inputs []winInput
	inputs = append(inputs, modDown...)

	if msg.Action == "down" {
		inputs = append(inputs, keyInput(uint16(vk), 0))
	} else {
		inputs = append(inputs, keyInputWithFlags(uint16(vk), keyeventfKeyUp))
	}

	inputs = append(inputs, modUp...)
	sendInputs(inputs)
}

func buildModifiers(msg orInputMsg) (down []winInput, up []winInput) {
	type modDef struct {
		active bool
		vk     uint16
	}
	mods := []modDef{
		{msg.Ctrl, 0x11},  // VK_CONTROL
		{msg.Shift, 0x10}, // VK_SHIFT
		{msg.Alt, 0x12},   // VK_MENU
		{msg.Meta, 0x5B},  // VK_LWIN
	}
	for _, m := range mods {
		if m.active {
			down = append(down, keyInput(m.vk, 0))
			up = append(up, keyInputWithFlags(m.vk, keyeventfKeyUp))
		}
	}
	return
}

// jsCodeToVK maps JavaScript KeyboardEvent.code values to Windows Virtual Key codes.
// Reference: https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
var jsCodeToVK = map[string]int{
	// Letters
	"KeyA": 0x41, "KeyB": 0x42, "KeyC": 0x43, "KeyD": 0x44,
	"KeyE": 0x45, "KeyF": 0x46, "KeyG": 0x47, "KeyH": 0x48,
	"KeyI": 0x49, "KeyJ": 0x4A, "KeyK": 0x4B, "KeyL": 0x4C,
	"KeyM": 0x4D, "KeyN": 0x4E, "KeyO": 0x4F, "KeyP": 0x50,
	"KeyQ": 0x51, "KeyR": 0x52, "KeyS": 0x53, "KeyT": 0x54,
	"KeyU": 0x55, "KeyV": 0x56, "KeyW": 0x57, "KeyX": 0x58,
	"KeyY": 0x59, "KeyZ": 0x5A,
	// Digits
	"Digit0": 0x30, "Digit1": 0x31, "Digit2": 0x32, "Digit3": 0x33,
	"Digit4": 0x34, "Digit5": 0x35, "Digit6": 0x36, "Digit7": 0x37,
	"Digit8": 0x38, "Digit9": 0x39,
	// Function keys
	"F1": 0x70, "F2": 0x71, "F3": 0x72, "F4": 0x73,
	"F5": 0x74, "F6": 0x75, "F7": 0x76, "F8": 0x77,
	"F9": 0x78, "F10": 0x79, "F11": 0x7A, "F12": 0x7B,
	// Navigation / editing
	"Enter":      0x0D,
	"Escape":     0x1B,
	"Backspace":  0x08,
	"Tab":        0x09,
	"Space":      0x20,
	"Delete":     0x2E,
	"Insert":     0x2D,
	"Home":       0x24,
	"End":        0x23,
	"PageUp":     0x21,
	"PageDown":   0x22,
	"ArrowLeft":  0x25,
	"ArrowUp":    0x26,
	"ArrowRight": 0x27,
	"ArrowDown":  0x28,
	// Modifiers
	"ShiftLeft": 0xA0, "ShiftRight": 0xA1,
	"ControlLeft": 0xA2, "ControlRight": 0xA3,
	"AltLeft": 0xA4, "AltRight": 0xA5,
	"MetaLeft": 0x5B, "MetaRight": 0x5C,
	// Symbols
	"Minus":         0xBD,
	"Equal":         0xBB,
	"BracketLeft":   0xDB,
	"BracketRight":  0xDD,
	"Backslash":     0xDC,
	"Semicolon":     0xBA,
	"Quote":         0xDE,
	"Backquote":     0xC0,
	"Comma":         0xBC,
	"Period":        0xBE,
	"Slash":         0xBF,
	"CapsLock":      0x14,
	"NumLock":       0x90,
	"ScrollLock":    0x91,
	"PrintScreen":   0x2C,
	"Pause":         0x13,
	// Numpad
	"Numpad0": 0x60, "Numpad1": 0x61, "Numpad2": 0x62, "Numpad3": 0x63,
	"Numpad4": 0x64, "Numpad5": 0x65, "Numpad6": 0x66, "Numpad7": 0x67,
	"Numpad8": 0x68, "Numpad9": 0x69,
	"NumpadMultiply": 0x6A,
	"NumpadAdd":      0x6B,
	"NumpadSubtract": 0x6D,
	"NumpadDecimal":  0x6E,
	"NumpadDivide":   0x6F,
	"NumpadEnter":    0x0D,
}
