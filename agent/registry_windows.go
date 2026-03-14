//go:build windows

package main

import (
	"fmt"

	"golang.org/x/sys/windows/registry"
)

// loadConfigFromRegistry reads ServerUrl and ApiKey from
// HKLM\SOFTWARE\OblianceAgent (written by the MSI installer at install time).
// Used as fallback when config.json doesn't exist yet.
func loadConfigFromRegistry() (*Config, error) {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\OblianceAgent`, registry.QUERY_VALUE)
	if err != nil {
		return nil, fmt.Errorf("registry key not found: %w", err)
	}
	defer k.Close()

	serverURL, _, err := k.GetStringValue("ServerUrl")
	if err != nil || serverURL == "" {
		return nil, fmt.Errorf("ServerUrl not in registry")
	}
	apiKey, _, err := k.GetStringValue("ApiKey")
	if err != nil || apiKey == "" {
		return nil, fmt.Errorf("ApiKey not in registry")
	}

	return &Config{
		ServerURL:            serverURL,
		APIKey:               apiKey,
		CheckIntervalSeconds: 60,
		AgentVersion:         agentVersion,
	}, nil
}
