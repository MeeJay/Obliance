//go:build !windows

package main

import _ "embed"

//go:embed icon_normal.png
var iconNormalData []byte

//go:embed icon_privacy.png
var iconPrivacyData []byte

//go:embed icon_disconnected.png
var iconDisconnectedData []byte

//go:embed icon_remote.png
var iconRemoteData []byte

//go:embed icon_airgap.png
var iconAirgapData []byte

func init() {
	iconNormal = iconNormalData
	iconPrivacy = iconPrivacyData
	iconDisconnected = iconDisconnectedData
	iconRemote = iconRemoteData
	iconAirgap = iconAirgapData
}
