//go:build windows

package main

import _ "embed"

//go:embed icon_normal.ico
var iconNormalData []byte

//go:embed icon_privacy.ico
var iconPrivacyData []byte

//go:embed icon_disconnected.ico
var iconDisconnectedData []byte

//go:embed icon_remote.ico
var iconRemoteData []byte

//go:embed icon_airgap.ico
var iconAirgapData []byte

func init() {
	iconNormal = iconNormalData
	iconPrivacy = iconPrivacyData
	iconDisconnected = iconDisconnectedData
	iconRemote = iconRemoteData
	iconAirgap = iconAirgapData
}
