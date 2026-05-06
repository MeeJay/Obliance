import type { DeviceStatus } from '@obliance/shared';

// A device is "reachable" — i.e. its agent is alive and the server is
// receiving pushes — whenever the status reflects a healthy connection,
// regardless of whether the metrics are breaching a threshold.
//
// `warning` and `critical` are status flags carried by an ONLINE device
// to surface metric breaches. They are NOT a reachability indicator —
// the agent is still talking to the server. Treating them as offline
// (which the UI used to do via `status === 'online'` everywhere) blocked
// remote control (Reach / SSH / PowerShell) on a critical box at the
// exact moment an admin needed to investigate.
//
// The states explicitly excluded:
//   - offline / pending_uninstall: agent unreachable.
//   - pending: not yet approved.
//   - suspended: admin paused operations.
//   - updating / update_error: in-flight self-update; commands queued.
//   - maintenance: admin marked the device down for maintenance.
export function isAgentReachable(status: DeviceStatus | null | undefined): boolean {
  return status === 'online' || status === 'warning' || status === 'critical';
}
