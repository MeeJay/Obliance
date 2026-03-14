# Obliance

Self-hosted Remote Monitoring & Management platform. Monitor endpoints, collect real-time system metrics, run scripts, manage updates, and automate remediation — across multi-tenant workspaces with full RBAC, in one command.
---
## Features at a Glance

- **13 monitor types** - HTTP, Ping, TCP, DNS, SSL, SMTP, Docker, Game Server, Push, Script, JSON API, Browser, Value Watcher
- **Native system agent** - Windows/Linux/macOS, with CPU, memory, disk, network, temperature, GPU metrics
- **10 notification channels** - Telegram, Discord, Slack, Teams, SMTP, Webhook, Gotify, Ntfy, Pushover, Free Mobile
- **5 remediation actions** - Webhook, N8N, Script, Docker restart, SSH command
- **Multi-tenant workspaces** - isolated tenants with per-workspace roles
- **Teams & RBAC** - read-only / read-write per group or monitor
- **Maintenance windows** - one-time or recurring, scope-based, suppresses notifications
- **2FA** - TOTP authenticator apps + Email OTP
- **Import / Export** - full config backup as JSON with conflict resolution
- **18 UI languages**
- **Real-time** - Socket.io live updates and live alert toasts
- **Desktop tray app** - Windows & macOS, multi-tenant tab bar, auto-update

---

## Monitor Types

| Type | Description |
|------|-------------|
| **HTTP(S)** | URL monitoring with keyword matching, status code validation, custom headers & body, upside-down mode |
| **Ping** | ICMP round-trip with response time tracking |
| **TCP Port** | Raw TCP connectivity to any host:port |
| **DNS** | Record lookup validation (A, AAAA, CNAME, MX, TXT…) |
| **SSL Certificate** | Certificate expiry monitoring with configurable warning threshold |
| **SMTP** | SMTP server availability check |
| **Docker Container** | Container running/stopped status via Docker socket |
| **Game Server** | Availability & player count via GameDig (Minecraft, CS2, Valheim, and 300+ games) |
| **Push / Heartbeat** | Passive monitoring - external systems POST to a token URL, Obliance alerts if they stop |
| **Script** | Run a shell command, validate exit code |
| **JSON API** | Fetch a JSON endpoint, extract a value via JSONPath, validate it |
| **Browser** | Headless Playwright browser check - renders JS, waits for selectors, optional screenshot on failure |
| **Value Watcher** | Numeric value monitoring with operators: `>`, `<`, `>=`, `<=`, `==`, `!=`, `between`, `changed` |

Agent monitors (CPU, memory, disk, etc.) are a 14th category managed through the native agent system.

---

## Native System Agent

A lightweight Go binary runs on monitored hosts and pushes metrics to the server every N seconds. No inbound ports required.

**Collected metrics**
- CPU usage (total + per-core)
- Memory & swap usage
- Disk usage per mount point
- Network throughput (in/out per interface)
- Temperatures - CPU, GPU, motherboard, NVMe (Windows: LibreHardwareMonitor + PawnIO + ASUS ATK; Linux/macOS: native sensors)
- GPU utilization, VRAM, temperature (NVIDIA & AMD)

**Installation**
- Windows: MSI installer (WiX v4) with optional PawnIO kernel driver for temperature sensors
- Linux / macOS: native binary, systemd / launchctl service
- Auto-update: agent downloads and reinstalls itself silently when a new version is available
- Auto-uninstall command via server → agent executes uninstaller and exits

**Configuration per device**
- Threshold overrides per metric (CPU, memory, disk, network, temperature)
- Group-level default thresholds with per-device override toggle
- Push interval (seconds) - group default or device-specific
- Heartbeat monitoring (alert if agent stops pushing)
- Display config: hide/show sections, custom labels, chart preferences
- Sensor display name renaming

**Device management**
- Approval workflow (auto or manual)
- Suspend / resume without deletion
- Bulk approve, suspend, or uninstall
- Auto-delete 10 minutes after uninstall command

---

## Notification Channels

Bind channels at **global**, **group**, or **monitor** level with **merge**, **replace**, or **exclude** inheritance modes.

| Channel | Notes |
|---------|-------|
| **Telegram** | Bot token + chat ID |
| **Discord** | Webhook URL |
| **Slack** | Incoming webhook |
| **Microsoft Teams** | Webhook URL |
| **Email (SMTP)** | Custom SMTP server or platform SMTP |
| **Webhook** | Generic HTTP - GET / POST / PUT / PATCH, custom headers |
| **Gotify** | Self-hosted push (server URL + token) |
| **Ntfy** | Self-hosted or ntfy.sh push |
| **Pushover** | Mobile push via Pushover app |
| **Free Mobile** | SMS via French mobile operator API |

**Group notification mode** - receive one alert when the first monitor in a group goes down, and one recovery when all are back up.

Test messages can be sent directly from the UI to validate channel configuration.

---

## Remediation System

Automatically react to monitor state changes with configurable actions.

| Action | Description |
|--------|-------------|
| **Generic Webhook** | HTTP request (GET / POST / PUT / PATCH) to any endpoint |
| **N8N Workflow** | Trigger an N8N automation workflow |
| **Custom Script** | Run a shell script on the Obliance server |
| **Docker Restart** | Restart a Docker container by name |
| **SSH Command** | Execute a remote command over SSH (password or key auth) |

- Trigger on: **down**, **up**, or **both**
- Configurable cooldown between executions
- Scope-based binding with merge / replace / exclude inheritance
- AES-256-GCM encryption for SSH credentials
- Full execution history: status, output, error, duration

---

## Multi-Tenant Workspaces

Create isolated workspaces (tenants) within a single Obliance instance.

- Each workspace has its own monitors, groups, teams, notification channels, settings, and remediation actions
- Users can belong to multiple workspaces with independent **admin** or **member** roles
- Platform admins have cross-workspace visibility and can manage all tenants
- Workspace switching from the UI without re-login
- Notification channels can be shared across workspaces

---

## Teams & RBAC

- Create **teams** per workspace
- Assign users to teams
- Grant teams **read-only** (RO) or **read-write** (RW) access per group or monitor
- Access cascades through the group hierarchy - assign a group and all children are covered
- `canCreate` flag per team: allows non-admins to create monitors/groups
- Platform admins always have full access to their workspace

---

## Hierarchical Groups

Organize monitors into nested groups with unlimited depth using a **closure table** for efficient queries.

- Settings cascade: configure once at a parent group, override where needed
- Notification channels cascade with merge / replace / exclude modes
- **General groups** are visible to all users regardless of team permissions
- Drag-and-drop reordering
- Group notification mode for aggregate alerting

---

## Settings Inheritance

| Level | Scope |
|-------|-------|
| Global | Applies to everything in the workspace |
| Group | Applies to the group and all subgroups |
| Monitor | Monitor-specific override |

Deleting a setting at any scope reverts it to the inherited value from the parent. Settings include: check interval, timeout, retry interval, max retries, heartbeat monitoring (agents), push interval (agents).

---

## Maintenance Windows

Suppress alerts and exclude downtime from uptime statistics during planned maintenance.

- **One-time** windows (auto-deleted after expiry) or **recurring** (daily / weekly)
- Scope: global, group, monitor, or agent device
- Scope inheritance - set a window on a group and it applies to all child monitors
- Heartbeat records are shown in blue during maintenance
- Notifications and remediations are suppressed
- Uptime % and response time averages exclude maintenance periods

---

## Two-Factor Authentication

- **TOTP** - any authenticator app (Google Authenticator, Authy, 1Password, etc.)
- **Email OTP** - one-time code sent via SMTP
- Optional system-wide enforcement (all users must enroll 2FA)
- Setup available during enrollment wizard or from the profile page

---

## Enrollment Wizard

New users are guided through a 4-step wizard on first login:

1. **Language** - pick from 18 supported languages
2. **Profile** - display name, email address
3. **Alerts** - configure notification preferences
4. **2FA** - optional TOTP or Email OTP setup

---

## Import / Export

Full configuration backup and restore as JSON.

**Exportable sections:** monitor groups, monitors, settings, notification channels, agent groups, teams, remediation actions, remediation bindings.

**Conflict resolution strategies** (when a UUID matches an existing record):
- **Update** - overwrite the existing record
- **Generate new** - create a duplicate with a fresh UUID
- **Skip** - leave the existing record untouched

Export and import are scoped to the **active workspace** - cross-tenant data is never included.

---

## Live Alerts

Real-time status-change notifications delivered via Socket.io without polling.

- Floating toast notifications (bottom-right stack, 1-minute auto-dismiss)
- Top-center banner showing the latest alert (10-second auto-dismiss)
- Click to navigate directly to the affected monitor or agent
- Per-workspace filtering - only see alerts relevant to your current tenant
- Desktop app: unread badge per workspace tab, optional auto-switch to the alerting workspace

---

## Desktop App

A lightweight system tray application (Go) for quick access without keeping a browser tab open.

- **Windows** (MSI installer) and **macOS** (DMG)
- Per-workspace tab bar - switch between tenants
- Unread alert badge per tab
- **Auto-cycle mode** - rotate through workspaces every N seconds
- **Follow alerts mode** - automatically switch to the workspace that just received an alert
- Auto-update with in-tray update prompt
- Starts minimized to tray, opens on click

---

## User Management

- Create, edit, disable, and delete users
- Platform roles: **admin** (full access) or **user** (team-based access)
- Per-user workspace assignment with **admin** or **member** role per workspace
- Password reset via email token (1-hour expiry)
- Admin safeguards: cannot delete or demote the last active admin

---

## Internationalization

18 UI languages with full translation coverage:

English · French · Spanish · German · Portuguese (BR) · Chinese (Simplified) · Japanese · Korean · Russian · Arabic · Italian · Dutch · Polish · Turkish · Swedish · Danish · Czech · Ukrainian

Language is saved per user and applied immediately without page reload.

---

## Real-Time Dashboard

- Live status updates via Socket.io - no manual refresh needed
- Per-monitor status: `UP`, `DOWN`, `ALERT`, `PAUSED`, `PENDING`, `MAINTENANCE`, `SSL_WARNING`, `SSL_EXPIRED`, `OFFLINE`
- 24-hour uptime %, average/min/max response time
- Group-level aggregated status (number of monitors down, in alert, pending, etc.)
- Bulk operations: multi-select, pause/resume, delete, edit
- Configurable heartbeat retention

---

## Deployment

### One-command install

```bash
curl -fsSL https://raw.githubusercontent.com/MeeJay/obliance/main/install.sh | sh
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
| `SESSION_SECRET` | Session signing secret | - |
| `PORT` | Server port | `3001` |
| `NODE_ENV` | `production` or `development` | `production` |
| `CLIENT_ORIGIN` | CORS origin for the client | `http://localhost` |
| `APP_NAME` | Prefix for notification messages | `Obliance` |
| `DEFAULT_ADMIN_USERNAME` | Admin account created on first run | `admin` |
| `DEFAULT_ADMIN_PASSWORD` | Admin password on first run | `admin123` |
| `MIN_CHECK_INTERVAL` | Minimum allowed check interval (seconds) | `10` |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Server** | Node.js 24 LTS, TypeScript, Express |
| **Database** | PostgreSQL 16, Knex (migrations + query builder) |
| **Real-time** | Socket.io |
| **Client** | React 18, Vite, Tailwind CSS, Zustand |
| **Agent** | Go (cross-platform binary) |
| **Desktop app** | Go (Wails / systray) |
| **Browser monitors** | Playwright (headless Chromium) |
| **Monorepo** | npm workspaces (`shared/`, `server/`, `client/`) |


> **🤖 An experiment with Claude Code**
>
> This project was built as an experiment to see how far Claude Code could be pushed as a development tool. Claude was used as a coding assistant throughout the entire development process.
