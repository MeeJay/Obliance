package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// downloadFile fetches url via HTTP GET and saves the response body to
// destDir/filename. Returns the full path of the saved file on success.
func downloadFile(url, destDir, filename string) (string, error) {
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return "", fmt.Errorf("create directory: %w", err)
	}
	dest := filepath.Join(destDir, filename)

	resp, err := http.Get(url) //nolint:gosec — URL is constructed from the saved server URL
	if err != nil {
		return "", fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("server returned %s", resp.Status)
	}

	f, err := os.Create(dest)
	if err != nil {
		return "", fmt.Errorf("create file: %w", err)
	}
	defer f.Close()

	if _, err = io.Copy(f, resp.Body); err != nil {
		return "", fmt.Errorf("write: %w", err)
	}
	return dest, nil
}

// revealFile opens the system file manager and highlights the given file.
func revealFile(path string) {
	switch runtime.GOOS {
	case "windows":
		// explorer /select,<path> highlights the file in the folder.
		exec.Command("explorer.exe", "/select,", path).Start() //nolint:errcheck
	case "darwin":
		// open -R reveals the file in Finder.
		exec.Command("open", "-R", path).Start() //nolint:errcheck
	}
}

// buildAbsoluteURL resolves a server-relative path against the saved server URL.
// Example: ("http://192.168.1.1:3001", "/downloads/Obliance.exe")
//
//	→ "http://192.168.1.1:3001/downloads/Obliance.exe"
func buildAbsoluteURL(serverURL, relPath string) string {
	return strings.TrimRight(serverURL, "/") + relPath
}
