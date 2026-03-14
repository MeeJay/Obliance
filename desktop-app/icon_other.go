//go:build !windows && !darwin

package main

import "unsafe"

// applyWindowIcon is a no-op on Linux and other platforms.
// On Linux, the window manager typically picks up the icon from the .desktop
// file or from _NET_WM_ICON. A GTK-based implementation could call
// gtk_window_set_icon_from_file() using w.Window() as the GtkWindow*.
func applyWindowIcon(_ unsafe.Pointer) {}
