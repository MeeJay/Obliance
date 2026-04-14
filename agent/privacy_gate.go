package main

// ============================================================================
// Privacy Gate — local password protecting privacy-mode override operations.
//
// The gate allows authorised users to unlock privacy-blocked features from the
// Obliance console WITHOUT fully disabling privacy mode. The password never
// leaves the device: only the hash is stored, and it lives in OS-protected
// storage (registry with SYSTEM-only DACL on Windows, 0600 root file on
// Linux, keychain on macOS — see privacy_gate_*.go).
//
// Rules enforced here (the agent is the source of truth):
//   - set/change/remove can only happen when privacy mode is OFF.
//   - verify can happen at any time (used to unlock features in privacy ON).
//   - unlock tokens are random UUIDs scoped to (feature, expires_at).
//   - Passwords are hashed with scrypt and never stored in plaintext.
// ============================================================================

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"golang.org/x/crypto/scrypt"
)

const (
	scryptN     = 32768
	scryptR     = 8
	scryptP     = 1
	scryptKey   = 32
	saltSize    = 16
	unlockTTL   = 15 * time.Minute // sliding window
	unlockMax   = 2 * time.Hour    // absolute max
	gateVersion = 1
)

type gateRecord struct {
	Version   int    `json:"version"`
	Salt      string `json:"salt"` // hex
	Hash      string `json:"hash"` // hex
	CreatedAt int64  `json:"created_at"`
}

type unlockSession struct {
	Token     string
	Feature   string
	CreatedAt time.Time
	LastUsed  time.Time
}

var (
	unlockMu       sync.Mutex
	activeUnlocks  = map[string]*unlockSession{} // key = token
)

// ── Public surface ──────────────────────────────────────────────────────────

// isPrivacyModeEnabled wraps the existing privacy state getter for clarity.
func isPrivacyModeEnabled() bool { return IsPrivacyMode() }

// IsPrivacyPasswordSet reports whether a privacy-gate password is configured.
func IsPrivacyPasswordSet() bool {
	raw, err := readPrivacyGateBlob()
	if err != nil || len(raw) == 0 {
		return false
	}
	var rec gateRecord
	return json.Unmarshal(raw, &rec) == nil && rec.Hash != "" && rec.Salt != ""
}

// SetPrivacyPassword stores a new password. Refused if privacy mode is ON or
// a password is already set (use ChangePrivacyPassword for that).
// No complexity requirement is enforced — the caller is free to use any
// non-empty password.
func SetPrivacyPassword(password string) error {
	if isPrivacyModeEnabled() {
		return fmt.Errorf("privacy mode is active, disable it first")
	}
	if IsPrivacyPasswordSet() {
		return fmt.Errorf("password already set, use change_privacy_password")
	}
	if password == "" {
		return fmt.Errorf("password cannot be empty")
	}
	rec, err := hashPassword(password)
	if err != nil {
		return err
	}
	return writeGate(rec)
}

// ChangePrivacyPassword replaces the existing password after verifying the
// old one. Refused when privacy mode is ON. No complexity requirement.
func ChangePrivacyPassword(oldPassword, newPassword string) error {
	if isPrivacyModeEnabled() {
		return fmt.Errorf("privacy mode is active, disable it first")
	}
	if !IsPrivacyPasswordSet() {
		return fmt.Errorf("no password set")
	}
	if !verifyStoredPassword(oldPassword) {
		return fmt.Errorf("incorrect password")
	}
	if newPassword == "" {
		return fmt.Errorf("password cannot be empty")
	}
	rec, err := hashPassword(newPassword)
	if err != nil {
		return err
	}
	return writeGate(rec)
}

// RemovePrivacyPassword deletes the stored password after verifying it.
// Refused when privacy mode is ON.
func RemovePrivacyPassword(password string) error {
	if isPrivacyModeEnabled() {
		return fmt.Errorf("privacy mode is active, disable it first")
	}
	if !IsPrivacyPasswordSet() {
		return nil
	}
	if !verifyStoredPassword(password) {
		return fmt.Errorf("incorrect password")
	}
	// Also clear any active unlock sessions.
	unlockMu.Lock()
	activeUnlocks = map[string]*unlockSession{}
	unlockMu.Unlock()
	return deletePrivacyGateBlob()
}

// VerifyPrivacyPassword checks the password and (on success) creates a
// feature-scoped unlock session returning a random token.
func VerifyPrivacyPassword(password, feature string) (string, error) {
	if !IsPrivacyPasswordSet() {
		return "", fmt.Errorf("no password set")
	}
	if !verifyStoredPassword(password) {
		return "", fmt.Errorf("incorrect password")
	}
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	now := time.Now()
	unlockMu.Lock()
	activeUnlocks[token] = &unlockSession{
		Token:     token,
		Feature:   feature,
		CreatedAt: now,
		LastUsed:  now,
	}
	unlockMu.Unlock()
	return token, nil
}

// CheckUnlockToken validates that the token is active for the given feature
// and refreshes its sliding expiry. Returns true if the token is valid.
func CheckUnlockToken(token, feature string) bool {
	if token == "" {
		return false
	}
	unlockMu.Lock()
	defer unlockMu.Unlock()
	s, ok := activeUnlocks[token]
	if !ok {
		return false
	}
	now := time.Now()
	if now.Sub(s.CreatedAt) > unlockMax {
		delete(activeUnlocks, token)
		return false
	}
	if now.Sub(s.LastUsed) > unlockTTL {
		delete(activeUnlocks, token)
		return false
	}
	if feature != "" && s.Feature != feature && s.Feature != "" {
		return false
	}
	s.LastUsed = now
	return true
}

// PurgeExpiredUnlocks is called periodically from the main loop.
func PurgeExpiredUnlocks() {
	now := time.Now()
	unlockMu.Lock()
	defer unlockMu.Unlock()
	for k, s := range activeUnlocks {
		if now.Sub(s.CreatedAt) > unlockMax || now.Sub(s.LastUsed) > unlockTTL {
			delete(activeUnlocks, k)
		}
	}
}

// ── Internals ───────────────────────────────────────────────────────────────

func hashPassword(password string) (*gateRecord, error) {
	salt := make([]byte, saltSize)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	hash, err := scrypt.Key([]byte(password), salt, scryptN, scryptR, scryptP, scryptKey)
	if err != nil {
		return nil, err
	}
	return &gateRecord{
		Version:   gateVersion,
		Salt:      hex.EncodeToString(salt),
		Hash:      hex.EncodeToString(hash),
		CreatedAt: time.Now().Unix(),
	}, nil
}

func verifyStoredPassword(password string) bool {
	raw, err := readPrivacyGateBlob()
	if err != nil || len(raw) == 0 {
		return false
	}
	var rec gateRecord
	if err := json.Unmarshal(raw, &rec); err != nil {
		return false
	}
	salt, err := hex.DecodeString(rec.Salt)
	if err != nil {
		return false
	}
	stored, err := hex.DecodeString(rec.Hash)
	if err != nil {
		return false
	}
	computed, err := scrypt.Key([]byte(password), salt, scryptN, scryptR, scryptP, scryptKey)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(stored, computed) == 1
}

func writeGate(rec *gateRecord) error {
	raw, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return writePrivacyGateBlob(raw)
}

func randomToken() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}
