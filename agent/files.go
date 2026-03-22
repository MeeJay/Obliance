package main

import (
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// maxDownloadSize is the maximum file size (150 MB) allowed for download_file.
const maxDownloadSize = 150 * 1024 * 1024

// FileInfo describes a single file or directory entry.
type FileInfo struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	IsDir    bool   `json:"isDir"`
	Size     int64  `json:"size"`
	Modified string `json:"modified"` // ISO 8601
	Mode     string `json:"mode"`     // e.g. "drwxr-xr-x" or "-rw-r--r--"
}

// dangerousPaths lists root/system paths that must never be deleted.
var dangerousPaths = map[string]bool{
	"/":                  true,
	"/bin":               true,
	"/sbin":              true,
	"/usr":               true,
	"/etc":               true,
	"/var":               true,
	"/boot":              true,
	"/lib":               true,
	"/System":            true,
	"/Applications":      true,
}

// isDangerousDelete returns true if the given path should never be deleted.
func isDangerousDelete(p string) bool {
	cleaned := filepath.Clean(p)

	// Unix roots
	if dangerousPaths[cleaned] {
		return true
	}

	// Windows: block drive roots and critical system directories.
	if runtime.GOOS == "windows" {
		upper := strings.ToUpper(cleaned)
		// Drive root: "C:\" or "C:"
		if len(upper) == 3 && upper[1] == ':' && (upper[2] == '\\' || upper[2] == '/') {
			return true
		}
		if len(upper) == 2 && upper[1] == ':' {
			return true
		}
		// Normalize separators for comparison.
		norm := strings.ReplaceAll(upper, "/", "\\")
		if norm == `C:\WINDOWS` || norm == `C:\WINDOWS\SYSTEM32` || norm == `C:\PROGRAM FILES` || norm == `C:\PROGRAM FILES (X86)` {
			return true
		}
	}

	return false
}

// containsTraversal checks for ".." path traversal attempts.
func containsTraversal(p string) bool {
	cleaned := filepath.Clean(p)
	// After Clean, ".." should only remain if the path escapes to a parent.
	return strings.Contains(cleaned, "..")
}

// payloadBool extracts a boolean from a command payload.
func payloadBool(payload map[string]interface{}, key string) bool {
	if payload == nil {
		return false
	}
	if v, ok := payload[key].(bool); ok {
		return v
	}
	return false
}

// ── handleListDirectory ──────────────────────────────────────────────────────

func (d *CommandDispatcher) handleListDirectory(cmd AgentCommand) (interface{}, error) {
	dirPath := payloadString(cmd.Payload, "path")

	// Empty path: list roots.
	if dirPath == "" {
		return listRoots()
	}

	if containsTraversal(dirPath) {
		return nil, fmt.Errorf("list_directory: path traversal not allowed")
	}

	dirPath = filepath.Clean(dirPath)

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, fmt.Errorf("list_directory: %w", err)
	}

	files := make([]FileInfo, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue // skip entries we cannot stat
		}
		fullPath := filepath.Join(dirPath, entry.Name())
		files = append(files, FileInfo{
			Name:     entry.Name(),
			Path:     fullPath,
			IsDir:    entry.IsDir(),
			Size:     info.Size(),
			Modified: info.ModTime().UTC().Format(time.RFC3339),
			Mode:     info.Mode().String(),
		})
	}

	// Sort: directories first, then alphabetical (case-insensitive).
	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDir != files[j].IsDir {
			return files[i].IsDir
		}
		return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
	})

	return map[string]interface{}{
		"path":  dirPath,
		"files": files,
	}, nil
}

// listRoots returns drive letters on Windows or "/" on Unix.
func listRoots() (interface{}, error) {
	if runtime.GOOS == "windows" {
		var drives []FileInfo
		for letter := 'A'; letter <= 'Z'; letter++ {
			drive := string(letter) + ":\\"
			info, err := os.Stat(drive)
			if err == nil {
				drives = append(drives, FileInfo{
					Name:     drive,
					Path:     drive,
					IsDir:    true,
					Size:     0,
					Modified: info.ModTime().UTC().Format(time.RFC3339),
					Mode:     info.Mode().String(),
				})
			}
		}
		return map[string]interface{}{
			"path":  "",
			"files": drives,
		}, nil
	}

	// Unix: list "/"
	entries, err := os.ReadDir("/")
	if err != nil {
		return nil, fmt.Errorf("list_directory: %w", err)
	}
	files := make([]FileInfo, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, FileInfo{
			Name:     entry.Name(),
			Path:     "/" + entry.Name(),
			IsDir:    entry.IsDir(),
			Size:     info.Size(),
			Modified: info.ModTime().UTC().Format(time.RFC3339),
			Mode:     info.Mode().String(),
		})
	}
	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDir != files[j].IsDir {
			return files[i].IsDir
		}
		return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
	})

	return map[string]interface{}{
		"path":  "/",
		"files": files,
	}, nil
}

// ── handleCreateDirectory ────────────────────────────────────────────────────

func (d *CommandDispatcher) handleCreateDirectory(cmd AgentCommand) (interface{}, error) {
	dirPath := payloadString(cmd.Payload, "path")
	if dirPath == "" {
		return nil, fmt.Errorf("create_directory: missing path")
	}
	if containsTraversal(dirPath) {
		return nil, fmt.Errorf("create_directory: path traversal not allowed")
	}

	dirPath = filepath.Clean(dirPath)

	if err := os.MkdirAll(dirPath, 0755); err != nil {
		return nil, fmt.Errorf("create_directory: %w", err)
	}

	log.Printf("Directory created: %s", dirPath)
	return map[string]interface{}{
		"path":    dirPath,
		"message": "directory created",
	}, nil
}

// ── handleRenameFile ─────────────────────────────────────────────────────────

func (d *CommandDispatcher) handleRenameFile(cmd AgentCommand) (interface{}, error) {
	oldPath := payloadString(cmd.Payload, "oldPath")
	newPath := payloadString(cmd.Payload, "newPath")
	if oldPath == "" || newPath == "" {
		return nil, fmt.Errorf("rename_file: missing oldPath or newPath")
	}
	if containsTraversal(oldPath) || containsTraversal(newPath) {
		return nil, fmt.Errorf("rename_file: path traversal not allowed")
	}

	oldPath = filepath.Clean(oldPath)
	newPath = filepath.Clean(newPath)

	if err := os.Rename(oldPath, newPath); err != nil {
		return nil, fmt.Errorf("rename_file: %w", err)
	}

	log.Printf("Renamed %s -> %s", oldPath, newPath)
	return map[string]interface{}{
		"oldPath": oldPath,
		"newPath": newPath,
		"message": "renamed",
	}, nil
}

// ── handleDeleteFile ─────────────────────────────────────────────────────────

func (d *CommandDispatcher) handleDeleteFile(cmd AgentCommand) (interface{}, error) {
	filePath := payloadString(cmd.Payload, "path")
	if filePath == "" {
		return nil, fmt.Errorf("delete_file: missing path")
	}
	if containsTraversal(filePath) {
		return nil, fmt.Errorf("delete_file: path traversal not allowed")
	}

	filePath = filepath.Clean(filePath)
	recursive := payloadBool(cmd.Payload, "recursive")

	// Safety: refuse to delete system-critical paths.
	if isDangerousDelete(filePath) {
		return nil, fmt.Errorf("delete_file: refusing to delete protected system path %q", filePath)
	}

	info, err := os.Stat(filePath)
	if err != nil {
		return nil, fmt.Errorf("delete_file: %w", err)
	}

	if info.IsDir() {
		if recursive {
			err = os.RemoveAll(filePath)
		} else {
			err = os.Remove(filePath) // fails if directory is not empty
		}
	} else {
		err = os.Remove(filePath)
	}

	if err != nil {
		return nil, fmt.Errorf("delete_file: %w", err)
	}

	log.Printf("Deleted: %s (recursive=%v)", filePath, recursive)
	return map[string]interface{}{
		"path":    filePath,
		"message": "deleted",
	}, nil
}

// ── handleDownloadFile ───────────────────────────────────────────────────────

func (d *CommandDispatcher) handleDownloadFile(cmd AgentCommand) (interface{}, error) {
	filePath := payloadString(cmd.Payload, "path")
	if filePath == "" {
		return nil, fmt.Errorf("download_file: missing path")
	}
	if containsTraversal(filePath) {
		return nil, fmt.Errorf("download_file: path traversal not allowed")
	}

	filePath = filepath.Clean(filePath)

	info, err := os.Stat(filePath)
	if err != nil {
		return nil, fmt.Errorf("download_file: %w", err)
	}
	if info.IsDir() {
		return nil, fmt.Errorf("download_file: path is a directory, not a file")
	}
	if info.Size() > maxDownloadSize {
		return nil, fmt.Errorf("download_file: file too large (%d bytes, max %d bytes)", info.Size(), maxDownloadSize)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("download_file: %w", err)
	}

	encoded := base64.StdEncoding.EncodeToString(data)
	name := filepath.Base(filePath)

	log.Printf("File downloaded: %s (%d bytes)", filePath, len(data))
	return map[string]interface{}{
		"path": filePath,
		"name": name,
		"size": len(data),
		"data": encoded,
	}, nil
}

// ── handleUploadFile ─────────────────────────────────────────────────────────

func (d *CommandDispatcher) handleUploadFile(cmd AgentCommand) (interface{}, error) {
	filePath := payloadString(cmd.Payload, "path")
	b64Data := payloadString(cmd.Payload, "data")
	if filePath == "" {
		return nil, fmt.Errorf("upload_file: missing path")
	}
	if b64Data == "" {
		return nil, fmt.Errorf("upload_file: missing data")
	}
	if containsTraversal(filePath) {
		return nil, fmt.Errorf("upload_file: path traversal not allowed")
	}

	filePath = filepath.Clean(filePath)
	overwrite := payloadBool(cmd.Payload, "overwrite")

	// Check if file already exists.
	if !overwrite {
		if _, err := os.Stat(filePath); err == nil {
			return nil, fmt.Errorf("upload_file: file already exists (set overwrite=true to replace)")
		}
	}

	data, err := base64.StdEncoding.DecodeString(b64Data)
	if err != nil {
		return nil, fmt.Errorf("upload_file: invalid base64 data: %w", err)
	}

	// Ensure parent directory exists.
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("upload_file: cannot create parent directory: %w", err)
	}

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return nil, fmt.Errorf("upload_file: %w", err)
	}

	log.Printf("File uploaded: %s (%d bytes)", filePath, len(data))
	return map[string]interface{}{
		"path":    filePath,
		"size":    len(data),
		"message": "file written",
	}, nil
}
