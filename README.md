# Obliance

Self-hosted Remote Monitoring & Management platform. Deploy lightweight agents on Windows, Linux and macOS endpoints, collect real-time system metrics, run scripts, manage updates and compliance, browse remote filesystems, take remote control, and automate fleet operations — across multi-tenant workspaces with full RBAC.

---

## Features at a Glance

- **Endpoint agent** — Go binary for Windows/Linux/macOS with CPU, memory, disk, network, temperature, GPU metrics
- **Script library** — run scripts on demand or on schedule across devices, with parameters and multi-runtime support
- **Remote sessions** — SSH, CMD, PowerShell terminals from the browser (SYSTEM or user session)
- **ObliReach** — real-time screen streaming (H.264, H.265, VP9, AV1, JPEG) with full input relay
- **File Explorer** — browse, upload, download, rename, delete files on remote devices with audit trail
- **Process Manager** — real-time process list, CPU/memory per process, kill processes
- **Service Manager** — start, stop, restart Windows/Linux services
- **Update management** — detect, approve, and deploy OS updates across the fleet (Windows Update, apt, yum, brew, winget, chocolatey)
- **Compliance engine** — 10 built-in presets (CIS, NIST, ISO 27001, PCI DSS, HIPAA, SOC 2...) + custom policies with auto-remediation
- **Hardware & software inventory** — full asset scan with history and retention policies
- **Network discovery** — IP scanning, device classification, managed/unmanaged tracking
- **Reporting** — fleet, compliance, scripts, updates, software reports in JSON, CSV, PDF, Excel, HTML
- **10 notification channels** — Telegram, Discord, Slack, Teams, SMTP, Webhook, Gotify, Ntfy, Pushover, Free Mobile
- **Multi-tenant workspaces** — isolated tenants with per-workspace roles
- **Teams & RBAC** — read-only / read-write per group or device, with granular capabilities
- **Maintenance windows** — one-time or recurring, scope-based, suppresses alerts
- **2FA** — TOTP authenticator apps + Email OTP
- **SSO** — federated login via Obligate
- **Privacy mode** — per-device toggle that blocks remote access, file explorer, process listing, and script execution
- **Import / Export** — full config backup as JSON with conflict resolution
- **18 UI languages**
- **Real-time** — Socket.io live updates and alert toasts
- **Agent tray icon** — Windows systray with connection status, privacy toggle, and version info

---

## Endpoint Agent

A lightweight Go binary deployed on managed endpoints. Pushes metrics to the server every N seconds — no inbound ports required.

**Collected metrics**
- CPU usage (total + per-core)
- Memory & swap usage
- Disk usage per mount point
- Network throughput (in/out per interface)
- Temperatures — CPU, GPU, motherboard, NVMe (Windows: LibreHardwareMonitor + PawnIO + ASUS ATK; Linux/macOS: native sensors)
- GPU utilization, VRAM, temperature (NVIDIA & AMD)

**Deployment**
- Windows: MSI installer (WiX v4) with optional PawnIO kernel driver for temperature sensors
- Linux / macOS: native binary, systemd / launchctl service
- Auto-update: agent downloads and reinstalls itself silently when a new version is available
- Auto-uninstall: server sends uninstall command, agent executes and exits

**Per-device configuration**
- Alert thresholds per metric (CPU, memory, disk, network, temperature)
- Group-level default thresholds with per-device override toggle
- Push interval (seconds) — group default or device-specific
- Heartbeat monitoring (alert if agent stops pushing)
- Sensor display name renaming

**Fleet management**
- Approval workflow (auto or manual)
- Suspend / resume without deletion
- Bulk approve, suspend, or uninstall
- Auto-delete after uninstall command
- Agent version tracking — dashboard shows up-to-date vs outdated agents
- API keys with optional default group assignment

---

## Remote Access

### Shell Sessions (SSH / CMD / PowerShell)

Open a full interactive terminal on any managed device directly from the browser.

- **Windows**: CMD or PowerShell via ConPTY (Windows 10 Build 1809+)
- **Linux / macOS**: bash or sh via PTY
- **Session context**: launch as SYSTEM or in a specific logged-in user's session (WTS session picker)
- **Resize**: terminal auto-resizes to match the browser window
- WebSocket relay with keepalive (proxy-safe)

### ObliReach — Remote Desktop

Real-time screen streaming built into the agent — no VNC server required.

- **5 codecs**: H.264 (OpenH264), H.265 (HEVC), VP9, AV1, JPEG fallback — per-user preference with automatic fallback
- Hardware-accelerated encoding (Windows Media Foundation)
- WebCodecs VideoDecoder in the browser (no plugin)
- Session picker: choose which logged-in user's desktop to view
- Full input relay: keyboard, mouse (move, click, scroll)
- Block remote user input (lock keyboard/mouse on the remote side)
- Adaptive quality based on network conditions
- RDP tunnel support

### File Explorer

Browse and manage files on remote devices from the browser.

- Navigate directories with breadcrumb path (drives on Windows, / on Unix)
- Upload files via drag & drop
- Download files with one click
- Create folders, rename, delete with confirmation
- **Audit trail**: all operations (create, rename, delete, upload) are logged
- **WebSocket-based**: instant response, no command queue overhead
- Disabled in Privacy Mode

### Process Manager

Real-time process monitoring via native Win32 APIs (no WMI overhead).

- Process list with PID, name, CPU %, memory, user
- CPU % calculated from `GetProcessTimes` deltas (Windows) or `/proc` (Linux)
- Kill processes remotely
- WebSocket subscription: live updates while the tab is open

### Service Manager

- List all Windows services or systemd units
- Start, stop, restart services remotely
- Service status with startup type

---

## Script Library & Scheduling

Manage and execute scripts across your fleet.

- **Multi-platform**: Windows, macOS, Linux, or cross-platform scripts
- **Multi-runtime**: PowerShell, Bash, Python, Perl, Ruby, and more
- **Parameterized scripts**: define typed parameters (string, number, boolean, secret, select, multiselect) filled at execution time
- **Immediate execution**: run on one device, a group, or the entire fleet
- **Scheduled execution**: cron-based or one-time schedules with timezone support
- **Catch-up execution**: automatically runs missed schedules when offline devices come back online
- **Execution history**: stdout, stderr, exit codes, duration per device
- **Status tracking**: pending, sent, running, success, failure, timeout, skipped, cancelled
- Script cloning for quick variations

---

## Update Management

Track and deploy OS and package updates across the fleet.

- **Multi-source detection**: Windows Update, apt, yum, dnf, pacman, brew, Chocolatey, WinGet
- **Severity classification**: critical, important, moderate, optional
- **Approval workflow**: available → approved → pending install → installed / failed
- **Update policies**: scheduled automatic installation with configurable rules
- **Reboot handling**: automatic reboot management after update deployment
- **Retry mechanism**: automatic retry for failed updates with bulk retry support
- **Update statistics**: fleet-wide update compliance reporting

---

## Compliance Engine

Define compliance policies and monitor your fleet's adherence.

- **10 built-in presets**: CIS Windows L1, Windows Baseline, Windows Performance, Linux Baseline, macOS Baseline, NIST 800-171, ISO 27001, PCI DSS v4, HIPAA, SOC 2
- **Custom policies**: define your own rules with flexible check types
- **Check types**: registry (Windows), file, command execution, service, event log, process, policy (GPO)
- **Operators**: eq, neq, contains, not_contains, exists, not_exists, gt, lt, regex
- **Severity levels**: optional, low, moderate, high, critical
- **Auto-remediation**: attach scripts to rules — automatically executed on compliance failures
- **Fleet compliance score** on the dashboard (0–100%)
- Per-device compliance tab with pass/fail details

---

## Hardware & Software Inventory

Full asset visibility across the fleet.

- **Hardware**: CPU, memory, disks, network interfaces, GPU, motherboard, BIOS
- **Software**: installed applications with version, publisher, install location
- **Multi-source detection**: registry, dpkg, rpm, pacman, brew, WinGet, Chocolatey, snap, flatpak
- **BitLocker**: recovery key collection for encrypted volumes (Windows)
- **History tracking**: hardware change detection over time
- **Retention policies**: configurable inventory data retention period
- **Asset fields**: purchase date, warranty status, warranty expiry per device

---

## Network Discovery

Discover devices on your network segments.

- IP range scanning with subnet filtering
- Device type classification (managed / unmanaged)
- Discovered devices list with filtering
- Discovery statistics on the dashboard

---

## Reporting

Generate fleet reports on demand or on schedule.

- **Formats**: JSON, CSV, PDF, Excel, HTML
- **Report types**: fleet overview, compliance, scripts, updates, software inventory, custom
- **Scope selection**: tenant-wide, group, or device
- **Section customization**: pick which sections to include
- **Scheduled reports**: cron-based automatic generation
- **Report expiration**: configurable output retention

---

## Notification Channels

Bind channels at **global**, **group**, or **device** level with **merge**, **replace**, or **exclude** inheritance modes.

| Channel | Notes |
|---------|-------|
| **Telegram** | Bot token + chat ID |
| **Discord** | Webhook URL |
| **Slack** | Incoming webhook |
| **Microsoft Teams** | Webhook URL |
| **Email (SMTP)** | Custom SMTP server |
| **Webhook** | Generic HTTP — GET / POST / PUT / PATCH, custom headers |
| **Gotify** | Self-hosted push (server URL + token) |
| **Ntfy** | Self-hosted or ntfy.sh push |
| **Pushover** | Mobile push via Pushover app |
| **Free Mobile** | SMS via French mobile operator API |

Test messages can be sent directly from the UI to validate channel configuration.

---

## Privacy Mode

Per-device privacy toggle that blocks all intrusive remote operations.

- Blocks: remote sessions, file explorer, process listing, script execution
- Can be enabled locally by the device user (tray app)
- Admin can force-disable remotely
- Privacy lock: make the config file read-only to prevent remote override
- When enabled: stops ObliReach service and disables auto-start

---

## Multi-Tenant Workspaces

Create isolated workspaces (tenants) within a single Obliance instance.

- Each workspace has its own devices, groups, teams, notification channels, and settings
- Users can belong to multiple workspaces with independent **admin** or **member** roles
- Platform admins have cross-workspace visibility and can manage all tenants
- Workspace switching from the UI without re-login

---

## Teams & RBAC

- Create **teams** per workspace
- Assign users to teams
- Grant teams **read-only** (RO) or **read-write** (RW) access per group or device
- **Granular capabilities**: execute scripts, remote access, file explorer, power actions (reboot/shutdown)
- Access cascades through the group hierarchy — assign a group and all children are covered
- `canCreate` flag per team: allows non-admins to create devices and groups
- Platform admins always have full access to their workspace

---

## Hierarchical Groups

Organize devices into nested groups with unlimited depth using a **closure table** for efficient queries.

- Settings cascade: configure once at a parent group, override where needed
- Notification channels cascade with merge / replace / exclude modes
- **General groups** are visible to all users regardless of team permissions
- Drag-and-drop reordering
- Recursive device listing in group detail views

---

## Settings Inheritance

| Level | Scope |
|-------|-------|
| Global | Applies to everything in the workspace |
| Group | Applies to the group and all subgroups |
| Device | Item-specific override |

Deleting a setting at any scope reverts it to the inherited value from the parent. Settings include: push interval, alert thresholds, heartbeat monitoring, and more.

---

## Maintenance Windows

Suppress alerts during planned maintenance.

- **One-time** windows (auto-deleted after expiry) or **recurring** (daily / weekly)
- Scope: global, group, or device
- Scope inheritance — set a window on a group and it applies to all children
- Notifications are suppressed during maintenance
- Timezone support

---

## Command Queue

Push-based command delivery system for agent control.

- **Command types**: run_script, install_update, scan_inventory, scan_updates, check_compliance, open_remote_tunnel, close_remote_tunnel, reboot, shutdown, install_software, uninstall_software, disable_privacy_mode, uninstall_agent, restart_agent
- **Priority levels**: low, normal, high, urgent
- **Real-time delivery** via WebSocket when agent is online
- **HTTP polling fallback** for agents behind restrictive firewalls
- Command status tracking with result capture (exit code, stdout, stderr)
- Command expiration and retry logic

---

## Audit Trail

Track who did what across the platform.

- **Command history**: every task (script, update, remote session) is logged with user, status, duration, and result
- **File explorer audit**: create, rename, delete, upload operations are logged with user, path, and timestamp
- **Remote session log**: session type, initiator, duration, and notes

---

## Two-Factor Authentication

- **TOTP** — any authenticator app (Google Authenticator, Authy, 1Password, etc.)
- **Email OTP** — one-time code sent via SMTP
- Optional system-wide enforcement (all users must enroll 2FA)

---

## SSO — Obligate

Federated authentication via **Obligate**, a companion SSO platform.

- OAuth authorize → code exchange → local user provisioning
- SSO users prefixed `og_` (e.g. `og_john.doe`)
- Configurable from admin settings

---

## Enrollment Wizard

New users are guided through a setup wizard on first login:

1. **Language** — pick from 18 supported languages
2. **Profile** — display name, email address
3. **Alerts** — configure notification preferences
4. **2FA** — optional TOTP or Email OTP setup

---

## Import / Export

Full configuration backup and restore as JSON.

**Exportable sections:** device groups, devices, settings, notification channels, teams.

**Conflict resolution strategies** (when a UUID matches an existing record):
- **Update** — overwrite the existing record
- **Generate new** — create a duplicate with a fresh UUID
- **Skip** — leave the existing record untouched

Export and import are scoped to the **active workspace** — cross-tenant data is never included.

---

## Live Alerts

Real-time status-change notifications delivered via Socket.io without polling.

- Floating toast notifications (bottom-right stack, auto-dismiss)
- Top-center banner showing the latest alert
- Click to navigate directly to the affected device
- Per-workspace filtering — only see alerts relevant to your current tenant

---

## Dashboard

- Live status updates via Socket.io — no manual refresh needed
- Fleet overview: online / offline / warning / critical counts
- Agent version tracking: up-to-date vs outdated agent count
- Pending OS updates count
- Fleet compliance score (0–100%)
- Group-level aggregated statistics with hierarchical display
- Bulk operations: multi-select, approve, suspend, delete

---

## Agent Tray Icon

System tray application (Go) running alongside the agent service on managed endpoints.

- **Windows only** (built with `-H windowsgui`, launched via `CreateProcessAsUser` in each user session)
- Shows agent version and connection status
- Toggle privacy mode on/off
- Auto-started via registry key, re-launched every 60 seconds by the agent service

---

## User Management

- Create, edit, disable, and delete users
- Platform roles: **admin** (full access) or **user** (team-based access)
- Per-user workspace assignment with **admin** or **member** role per workspace
- Password reset via email token
- User avatar (profile photo)
- Admin safeguards: cannot delete or demote the last active admin

---

## Internationalization

18 UI languages with full translation coverage:

English - French - Spanish - German - Portuguese (BR) - Chinese (Simplified) - Japanese - Korean - Russian - Arabic - Italian - Dutch - Polish - Turkish - Swedish - Danish - Czech - Ukrainian

Language is saved per user and applied immediately without page reload.

---

## Deployment

### One-command install

```bash
curl -fsSL https://raw.githubusercontent.com/MeeJay/Obliance/master/install.sh | sh
```

### Docker Compose (built-in PostgreSQL)

```bash
docker compose up -d
```

### Docker Compose (external PostgreSQL)

```bash
docker compose -f docker-compose.external-db.yml up -d
```

Set `DATABASE_URL` in your `.env` to point at your existing PostgreSQL instance.

### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://obliance:changeme@localhost:5432/obliance` |
| `SESSION_SECRET` | Session signing secret | — |
| `PORT` | Server port | `3001` |
| `NODE_ENV` | `production` or `development` | `production` |
| `CLIENT_ORIGIN` | CORS origin for the client | `http://localhost` |
| `APP_NAME` | Prefix for notification messages | `Obliance` |
| `DEFAULT_ADMIN_USERNAME` | Admin account created on first run | `admin` |
| `DEFAULT_ADMIN_PASSWORD` | Admin password on first run | `admin123` |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Server** | Node.js, TypeScript, Express |
| **Database** | PostgreSQL 16, Knex (migrations + query builder) |
| **Real-time** | Socket.io |
| **Client** | React, Vite, Tailwind CSS, Zustand |
| **Agent** | Go (cross-platform binary) |
| **Tray icon** | Go (systray, Windows) |
| **Monorepo** | npm workspaces (`shared/`, `server/`, `client/`) |


> **An experiment with Claude Code**
>
> This project was built as an experiment to see how far Claude Code could be pushed as a development tool. Claude was used as a coding assistant throughout the entire development process.
