#!/usr/bin/env node
/**
 * Obliance Agent v1.0.0
 * Lightweight monitoring agent for Windows and Linux.
 *
 * Usage:
 *   node index.js --url https://my-obliance.com --key <api-key>
 *   node index.js  (uses existing config)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const crypto = require('crypto');

// ── Config paths ──────────────────────────────────────────────────────────────

const IS_WINDOWS = process.platform === 'win32';
// Detect pkg-bundled execution (Windows MSI install).
// Auto-update is disabled in this mode — update via MSI reinstallation instead.
const IS_PKG = typeof process.pkg !== 'undefined';
const CONFIG_DIR = IS_WINDOWS
  ? path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'OblianceAgent')
  : '/etc/obliance-agent';
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const AGENT_FILE = path.join(IS_WINDOWS
  ? 'C:\\Program Files\\OblianceAgent\\src'
  : '/opt/obliance-agent/src', 'index.js');

// ── Backoff state (resets on service restart) ─────────────────────────────────

const BACKOFF_STEPS = [5 * 60, 10 * 60, 30 * 60, 60 * 60]; // seconds
let backoffLevel = 0;

// ── Helpers ────────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] ${msg}\n`);
}

// Windows MSI: read SERVERURL and APIKEY from registry (written at install time).
// On first run the agent generates its UUID and writes config.json.
// After that, config.json is used directly and the registry keys are no longer needed.
function loadConfigFromRegistry() {
  try {
    const { execSync } = require('child_process');
    const out = execSync('reg query "HKLM\\SOFTWARE\\OblianceAgent"', { encoding: 'utf-8' });
    const url = out.match(/ServerUrl\s+REG_SZ\s+(.+)/)?.[1]?.trim();
    const key = out.match(/ApiKey\s+REG_SZ\s+(.+)/)?.[1]?.trim();
    if (url && key) {
      return { serverUrl: url, apiKey: key, checkIntervalSeconds: 60, agentVersion: '1.0.0' };
    }
  } catch { /* registry absent or keys not set */ }
  return null;
}

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch { /* fall through */ }
  }
  // Windows MSI: fallback to registry written by installer
  if (IS_WINDOWS) return loadConfigFromRegistry();
  return null;
}

function saveConfig(cfg) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg, i, arr) => {
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = arr[i + 1];
      if (val && !val.startsWith('--')) args[key] = val;
      else args[key] = true;
    }
  });
  return args;
}

function generateUuid() {
  return crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomBytes(16).toString('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

function httpRequest(url, options = {}, bodyData = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 30000,
    };

    if (bodyData) {
      const body = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

    if (bodyData) {
      req.write(typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
    }
    req.end();
  });
}

// ── Auto-update ────────────────────────────────────────────────────────────────

async function checkForUpdate(config) {
  // pkg-bundled exe cannot replace itself while running on Windows.
  // Reinstall the MSI to update.
  if (IS_PKG) {
    log('Running as packaged executable — auto-update disabled. Reinstall MSI to update.');
    return;
  }
  try {
    const res = await httpRequest(`${config.serverUrl}/api/agent/version`);
    if (res.status !== 200 || !res.body.version) return;

    const currentVersion = config.agentVersion || '1.0.0';
    const latestVersion = res.body.version;

    if (latestVersion === currentVersion) {
      log(`Agent is up to date (${currentVersion})`);
      return;
    }

    log(`Update available: ${currentVersion} → ${latestVersion}. Downloading...`);

    const dlRes = await httpRequest(`${config.serverUrl}${res.body.downloadUrl || '/api/agent/download/agent.js'}`);
    if (dlRes.status !== 200) {
      log('Failed to download update');
      return;
    }

    // Write new agent file
    const newContent = typeof dlRes.body === 'string' ? dlRes.body : JSON.stringify(dlRes.body);
    fs.writeFileSync(AGENT_FILE, newContent, 'utf-8');

    // Update version in config
    config.agentVersion = latestVersion;
    saveConfig(config);

    log(`Update installed. Restarting agent...`);
    process.exit(0); // Service manager (systemd/Windows Service) will restart it
  } catch (err) {
    log(`Auto-update check failed: ${err.message}`);
  }
}

// ── Metrics collection ─────────────────────────────────────────────────────────

async function collectMetrics() {
  const si = require('systeminformation');

  const [cpu, mem, disks, net, load] = await Promise.all([
    si.currentLoad().catch(() => null),
    si.mem().catch(() => null),
    si.fsSize().catch(() => []),
    si.networkStats().catch(() => null),
    si.currentLoad().catch(() => null),
  ]);

  const metrics = {};

  if (cpu) {
    metrics.cpu = { percent: Math.round(cpu.currentLoad * 10) / 10 };
  }

  if (mem) {
    const totalMb = Math.round(mem.total / 1048576);
    const usedMb = Math.round((mem.total - mem.available) / 1048576);
    metrics.memory = {
      totalMb,
      usedMb,
      percent: Math.round((usedMb / totalMb) * 1000) / 10,
    };
  }

  if (disks && disks.length > 0) {
    metrics.disks = disks
      .filter(d => d.size > 0)
      .map(d => ({
        mount: d.mount,
        totalGb: Math.round(d.size / 1073741824 * 10) / 10,
        usedGb: Math.round(d.used / 1073741824 * 10) / 10,
        percent: Math.round((d.use || 0) * 10) / 10,
      }));
  }

  if (net) {
    // Sum all interfaces
    const allNet = Array.isArray(net) ? net : [net];
    const inBytes = allNet.reduce((sum, n) => sum + (n.rx_sec || 0), 0);
    const outBytes = allNet.reduce((sum, n) => sum + (n.tx_sec || 0), 0);
    metrics.network = {
      inBytesPerSec: Math.round(inBytes),
      outBytesPerSec: Math.round(outBytes),
    };
  }

  if (load) {
    metrics.loadAvg = Math.round((load.avgLoad || 0) * 100) / 100;
  }

  return metrics;
}

async function getOsInfo() {
  try {
    const si = require('systeminformation');
    const info = await si.osInfo();
    return {
      platform: info.platform || os.platform(),
      distro: info.distro || null,
      release: info.release || os.release(),
      arch: info.arch || os.arch(),
    };
  } catch {
    return {
      platform: os.platform(),
      distro: null,
      release: os.release(),
      arch: os.arch(),
    };
  }
}

// ── Main push loop ─────────────────────────────────────────────────────────────

async function push(config) {
  try {
    const metrics = await collectMetrics();
    const osInfo = await getOsInfo();

    const body = {
      hostname: os.hostname(),
      agentVersion: config.agentVersion || '1.0.0',
      osInfo,
      metrics,
    };

    const res = await httpRequest(
      `${config.serverUrl}/api/agent/push`,
      {
        method: 'POST',
        headers: {
          'X-API-Key': config.apiKey,
          'X-Device-UUID': config.deviceUuid,
        },
      },
      body,
    );

    if (res.status === 200 && res.body.status === 'ok') {
      backoffLevel = 0;
      if (res.body.config?.checkIntervalSeconds) {
        const newInterval = res.body.config.checkIntervalSeconds;
        if (newInterval !== config.checkIntervalSeconds) {
          config.checkIntervalSeconds = newInterval;
          saveConfig(config);
          log(`Check interval updated to ${newInterval}s`);
        }
      }
      log(`Push OK (metrics sent)`);
    } else if (res.status === 202 && res.body.status === 'pending') {
      log(`Device pending approval...`);
      if (res.body.config?.checkIntervalSeconds) {
        config.checkIntervalSeconds = res.body.config.checkIntervalSeconds;
        saveConfig(config);
      }
    } else if (res.status === 401) {
      const backoffSecs = BACKOFF_STEPS[Math.min(backoffLevel, BACKOFF_STEPS.length - 1)];
      log(`Unauthorized (refused or invalid key). Backing off for ${backoffSecs}s...`);
      backoffLevel++;
      config._backoffUntil = Date.now() + backoffSecs * 1000;
    } else {
      log(`Push returned unexpected status ${res.status}`);
    }
  } catch (err) {
    log(`Push error: ${err.message}`);
  }
}

async function loop(config) {
  while (true) {
    // Check backoff
    if (config._backoffUntil && Date.now() < config._backoffUntil) {
      const waitSec = Math.ceil((config._backoffUntil - Date.now()) / 1000);
      log(`In backoff period, waiting ${waitSec}s...`);
      await sleep(Math.min(waitSec, 60) * 1000);
      continue;
    }

    await push(config);
    await sleep(config.checkIntervalSeconds * 1000);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Entry point ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  let config = loadConfig();

  // First-time setup
  if (!config) {
    if (!args.url || !args.key) {
      process.stderr.write(
        'First run: provide --url <serverUrl> --key <apiKey>\n' +
        'Example: node index.js --url https://obliance.example.com --key your-api-key\n'
      );
      process.exit(1);
    }
    config = {
      serverUrl: String(args.url).replace(/\/$/, ''),
      apiKey: String(args.key),
      deviceUuid: generateUuid(),
      checkIntervalSeconds: 60,
      agentVersion: '1.0.0',
    };
    saveConfig(config);
    log(`First run: config saved to ${CONFIG_FILE}`);
  }

  // Override from args if provided
  if (args.url) config.serverUrl = String(args.url).replace(/\/$/, '');
  if (args.key) config.apiKey = String(args.key);

  // Ensure deviceUuid exists (may be missing if config was written by MSI installer)
  if (!config.deviceUuid) {
    config.deviceUuid = generateUuid();
    saveConfig(config);
    log(`Generated device UUID: ${config.deviceUuid}`);
  }

  log(`Obliance Agent v${config.agentVersion || '1.0.0'} starting...`);
  log(`Server: ${config.serverUrl}`);
  log(`Device UUID: ${config.deviceUuid}`);

  // Auto-update check on startup
  await checkForUpdate(config);

  // Main loop
  await loop(config);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
