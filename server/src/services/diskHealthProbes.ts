/**
 * Embedded disk-health (SMART) probes shipped with the server image.
 *
 * These are dispatched by `diskHealthCollector.service` via the standard
 * `run_script` command — the SAME command every agent (modern AND legacy)
 * already understands — so there is ZERO agent change and nothing for an admin
 * to deploy. An out-of-date agent simply runs the script and reports back; a
 * disk that can't answer SMART yields an empty `disks` array (never an error),
 * so the feature is purely additive and never breaks anything.
 *
 * Output contract (last stdout line = compact JSON), consumed by
 * command.service.ts -> diskHealthService.saveFromScript:
 *   { value, unit, label, status, disks: [ { model, serial, type, tempC,
 *     healthPct, wearPct, powerOnHours, reallocatedSectors, pendingSectors,
 *     status } ] }
 *
 * Linux/macOS depend on `smartctl` (smartmontools) — the universal SMART tool.
 * When it is absent the Unix probe pulls a static `smartctl` from THIS server
 * (`/api/agent-tools/smartctl`), verifies its sha256, caches it under
 * /var/lib/obliance/tools and runs it — no package manager, no OS mutation,
 * works without internet/repos. If neither the binary nor a hosted copy is
 * available, it degrades to an empty disk set.
 *
 * NOTE (maintainers): both scripts are written to embed cleanly in a JS
 * template literal — no backticks, no `${...}` (bash uses `$(...)` / `$((...))`
 * / `$$` only) and no backslash escapes. Keep it that way when editing.
 */

// ── Windows: 100% native (Get-PhysicalDisk / Get-StorageReliabilityCounter).
//    No tool to install. Get-PhysicalDisk needs Win8/Server 2012+ — on older
//    hosts (2008 R2 legacy agent) the cmdlet is absent and the script emits an
//    empty disk set, which is fine.
const WINDOWS_PROBE = `$ErrorActionPreference = 'SilentlyContinue'

$order = @{ good = 0; caution = 1; bad = 2 }
$worst = 'good'
$disks = @()

$phys = @()
try { $phys = @(Get-PhysicalDisk) } catch { }

foreach ($d in $phys) {
    $rc = $null
    try { $rc = $d | Get-StorageReliabilityCounter } catch { }

    $temp = if ($rc -and $rc.Temperature -ne $null -and $rc.Temperature -gt 0) { [int]$rc.Temperature } else { $null }
    $wear = if ($rc -and $rc.Wear -ne $null) { [int]$rc.Wear } else { $null }
    $poh  = if ($rc -and $rc.PowerOnHours -ne $null) { [int]$rc.PowerOnHours } else { $null }

    $media = "$($d.MediaType)"
    if ($media -notin @('HDD', 'SSD', 'SCM')) { $media = 'unknown' }
    $health = "$($d.HealthStatus)"

    $st = 'good'
    if ($health -eq 'Warning')   { $st = 'caution' }
    if ($health -eq 'Unhealthy') { $st = 'bad' }
    if ($temp -ne $null) {
        if     ($temp -ge 70) { if ($order[$st] -lt $order['bad'])     { $st = 'bad' } }
        elseif ($temp -ge 60) { if ($order[$st] -lt $order['caution']) { $st = 'caution' } }
    }
    if ($wear -ne $null) {
        if     ($wear -ge 90) { if ($order[$st] -lt $order['bad'])     { $st = 'bad' } }
        elseif ($wear -ge 80) { if ($order[$st] -lt $order['caution']) { $st = 'caution' } }
    }
    if ($order[$st] -gt $order[$worst]) { $worst = $st }

    $healthPct = if ($wear -ne $null) { 100 - $wear } else { $null }

    $disks += [pscustomobject]@{
        model        = "$($d.FriendlyName)".Trim()
        serial       = "$($d.SerialNumber)".Trim()
        type         = $media
        tempC        = $temp
        healthPct    = $healthPct
        wearPct      = $wear
        powerOnHours = $poh
        status       = $st
    }
}

$statusMap = @{ good = 'ok'; caution = 'warning'; bad = 'critical' }
$valMap    = @{ good = 'OK'; caution = 'Attention'; bad = 'Critique' }

if ($disks.Count -eq 0) {
    [pscustomobject]@{ value = 'n/a'; unit = ''; label = 'Sante disque'; status = 'error'; disks = @() } |
        ConvertTo-Json -Depth 5 -Compress
} else {
    [pscustomobject]@{
        value  = $valMap[$worst]
        unit   = ''
        label  = 'Sante disque'
        status = $statusMap[$worst]
        disks  = $disks
    } | ConvertTo-Json -Depth 5 -Compress
}
`;

// ── Unix probe body (Linux/macOS/BSD). OBL_URL / OBL_TOKEN / OBL_SHA_* are
//    injected as a header by buildUnixProbe() below. When OBL_URL is empty the
//    self-provisioning download is simply skipped (PATH smartctl only).
const UNIX_PROBE_BODY = `emit() { echo "$1"; exit 0; }

# JSON-safe string: drop double-quotes and trim.
san() { printf '%s' "$1" | tr -d '"' | sed 's/^ *//;s/ *$//'; }
# Emit an int, else the literal null.
jn() { if [ -n "$1" ] && printf '%s' "$1" | grep -qE '^-?[0-9]+$'; then printf '%s' "$1"; else printf 'null'; fi; }

CACHE_DIR=/var/lib/obliance/tools
CACHE=$CACHE_DIR/smartctl

# Resolve a usable smartctl: PATH -> local cache -> download static binary from
# Obliance (Linux only; verified by sha256). Prints the path or nothing.
find_smartctl() {
  P="$(command -v smartctl 2>/dev/null || true)"
  if [ -n "$P" ]; then echo "$P"; return 0; fi
  if [ -x "$CACHE" ]; then echo "$CACHE"; return 0; fi
  [ -z "$OBL_URL" ] && return 1
  [ "$(uname -s)" != "Linux" ] && return 1
  A=""; WANT=""
  case "$(uname -m)" in
    x86_64|amd64) A=amd64; WANT="$OBL_SHA_amd64" ;;
    aarch64|arm64) A=arm64; WANT="$OBL_SHA_arm64" ;;
    *) return 1 ;;
  esac
  [ -z "$WANT" ] && return 1
  mkdir -p "$CACHE_DIR" 2>/dev/null || return 1
  TMP=$CACHE.dl.$$
  URL="$OBL_URL?arch=$A&token=$OBL_TOKEN"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" -o "$TMP" 2>/dev/null || { rm -f "$TMP"; return 1; }
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TMP" "$URL" 2>/dev/null || { rm -f "$TMP"; return 1; }
  else
    return 1
  fi
  GOT=""
  if command -v sha256sum >/dev/null 2>&1; then GOT="$(sha256sum "$TMP" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then GOT="$(shasum -a 256 "$TMP" | awk '{print $1}')"; fi
  if [ -n "$GOT" ] && [ "$GOT" != "$WANT" ]; then rm -f "$TMP"; return 1; fi
  chmod 0755 "$TMP" 2>/dev/null
  mv "$TMP" "$CACHE" 2>/dev/null || { rm -f "$TMP"; return 1; }
  echo "$CACHE"; return 0
}

SMARTCTL="$(find_smartctl)"
if [ -z "$SMARTCTL" ]; then
  emit '{"value":"n/a","unit":"","label":"Sante disque","status":"error","disks":[],"note":"smartmontools not available"}'
fi

SCAN="$("$SMARTCTL" --scan 2>/dev/null)"
if [ -z "$SCAN" ]; then
  emit '{"value":"n/a","unit":"","label":"Sante disque","status":"error","disks":[],"note":"no smart-capable device"}'
fi

WORST=0
DISKS=""
SEP=""

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    /dev/*) : ;;
    *) continue ;;
  esac
  dev="$(printf '%s' "$line" | awk '{print $1}')"
  dtype="$(printf '%s' "$line" | awk '{for(i=1;i<NF;i++) if($i=="-d"){print $(i+1); exit}}')"
  if [ -n "$dtype" ]; then
    INFO="$("$SMARTCTL" -i -H -A -d "$dtype" "$dev" 2>/dev/null)"
  else
    INFO="$("$SMARTCTL" -i -H -A "$dev" 2>/dev/null)"
  fi
  [ -z "$INFO" ] && continue

  model="$(printf '%s' "$INFO" | grep -iE '^(Device Model|Model Number|Product):' | head -1 | sed 's/^[^:]*: *//')"
  [ -z "$model" ] && model="$(printf '%s' "$INFO" | grep -iE '^Model Family:' | head -1 | sed 's/^[^:]*: *//')"
  serial="$(printf '%s' "$INFO" | grep -iE '^Serial [Nn]umber:' | head -1 | sed 's/^[^:]*: *//')"

  dt="unknown"
  case "$dev" in *nvme*) dt="NVMe" ;; esac
  if [ "$dt" = "unknown" ]; then
    rot="$(printf '%s' "$INFO" | grep -iE '^Rotation Rate:' | head -1)"
    case "$rot" in
      *Solid*State*) dt="SSD" ;;
      *rpm*|*RPM*) dt="HDD" ;;
    esac
  fi

  hbad=0
  printf '%s' "$INFO" | grep -qiE 'overall-health.*(FAILED|FAILING)' && hbad=1
  printf '%s' "$INFO" | grep -qiE 'SMART Health Status: *(FAIL|FAILED)' && hbad=1

  temp="$(printf '%s' "$INFO" | awk 'tolower($0) ~ /temperature_celsius|airflow_temperature/ {print $10; exit}')"
  [ -z "$temp" ] && temp="$(printf '%s' "$INFO" | awk -F: '/^Temperature:/ {gsub(/[^0-9]/,"",$2); print $2; exit}')"
  [ -z "$temp" ] && temp="$(printf '%s' "$INFO" | awk -F: '/Current Drive Temperature/ {gsub(/[^0-9]/,"",$2); print $2; exit}')"

  poh="$(printf '%s' "$INFO" | awk '/Power_On_Hours/ {print $10; exit}')"
  [ -z "$poh" ] && poh="$(printf '%s' "$INFO" | awk -F: '/^Power On Hours:/ {gsub(/[^0-9]/,"",$2); print $2; exit}')"

  realloc="$(printf '%s' "$INFO" | awk '/Reallocated_Sector_Ct/ {print $10; exit}')"
  pending="$(printf '%s' "$INFO" | awk '/Current_Pending_Sector/ {print $10; exit}')"

  wear="$(printf '%s' "$INFO" | awk -F: '/Percentage Used:/ {gsub(/[^0-9]/,"",$2); print $2; exit}')"
  if [ -z "$wear" ]; then
    nv="$(printf '%s' "$INFO" | awk 'tolower($0) ~ /wear_leveling_count|media_wearout_indicator|ssd_life_left/ {print $4; exit}')"
    if printf '%s' "$nv" | grep -qE '^[0-9]+$'; then wear="$(( 100 - nv ))"; fi
  fi

  st=0
  [ "$hbad" -eq 1 ] && st=2
  if printf '%s' "$temp" | grep -qE '^[0-9]+$'; then
    if [ "$temp" -ge 70 ]; then st=2; elif [ "$temp" -ge 60 ] && [ "$st" -lt 1 ]; then st=1; fi
  fi
  if printf '%s' "$wear" | grep -qE '^[0-9]+$'; then
    if [ "$wear" -ge 90 ]; then st=2; elif [ "$wear" -ge 80 ] && [ "$st" -lt 1 ]; then st=1; fi
  fi
  if printf '%s' "$pending" | grep -qE '^[0-9]+$' && [ "$pending" -gt 0 ] && [ "$st" -lt 1 ]; then st=1; fi
  if printf '%s' "$realloc" | grep -qE '^[0-9]+$' && [ "$realloc" -gt 0 ] && [ "$st" -lt 1 ]; then st=1; fi

  case "$st" in 2) sstr="bad" ;; 1) sstr="caution" ;; *) sstr="good" ;; esac
  [ "$st" -gt "$WORST" ] && WORST="$st"

  hp=""
  if printf '%s' "$wear" | grep -qE '^[0-9]+$'; then hp="$(( 100 - wear ))"; fi

  obj="$(printf '{"model":"%s","serial":"%s","type":"%s","tempC":%s,"healthPct":%s,"wearPct":%s,"powerOnHours":%s,"reallocatedSectors":%s,"pendingSectors":%s,"status":"%s"}' "$(san "$model")" "$(san "$serial")" "$dt" "$(jn "$temp")" "$(jn "$hp")" "$(jn "$wear")" "$(jn "$poh")" "$(jn "$realloc")" "$(jn "$pending")" "$sstr")"
  DISKS="$DISKS$SEP$obj"
  SEP=","
done < <(printf '%s' "$SCAN")

if [ -z "$DISKS" ]; then
  emit '{"value":"n/a","unit":"","label":"Sante disque","status":"error","disks":[]}'
fi

case "$WORST" in
  2) VAL="Critique"; STATUS="critical" ;;
  1) VAL="Attention"; STATUS="warning" ;;
  *) VAL="OK"; STATUS="ok" ;;
esac

echo "$(printf '{"value":"%s","unit":"","label":"Sante disque","status":"%s","disks":[%s]}' "$VAL" "$STATUS" "$DISKS")"
`;

export interface DiskProbe {
  runtime: string;   // matches the agent's run_script runtime enum
  content: string;
}

export interface ProbeContext {
  toolsUrl?: string;      // absolute URL of GET /api/agent-tools/smartctl (no query)
  toolsToken?: string;    // short-lived HMAC token authorizing this device
  sha256Amd64?: string;
  sha256Arm64?: string;
}

// Strip anything that could break out of the double-quoted shell assignment.
function shq(v: string | undefined): string {
  return (v ?? '').replace(/["'`$\\\r\n]/g, '');
}

function buildUnixProbe(ctx?: ProbeContext): string {
  const header =
    `#!/bin/bash\n` +
    `OBL_URL="${shq(ctx?.toolsUrl)}"\n` +
    `OBL_TOKEN="${shq(ctx?.toolsToken)}"\n` +
    `OBL_SHA_amd64="${shq(ctx?.sha256Amd64)}"\n` +
    `OBL_SHA_arm64="${shq(ctx?.sha256Arm64)}"\n`;
  return header + UNIX_PROBE_BODY;
}

/** Return the probe for a device OS, or null for OSes we don't collect SMART on. */
export function getDiskProbe(osType: string | null | undefined, ctx?: ProbeContext): DiskProbe | null {
  switch ((osType ?? '').toLowerCase()) {
    case 'windows':
      return { runtime: 'powershell', content: WINDOWS_PROBE };
    case 'linux':
    case 'macos':
    case 'freebsd':
      return { runtime: 'bash', content: buildUnixProbe(ctx) };
    default:
      return null;
  }
}
