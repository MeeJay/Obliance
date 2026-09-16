import fs from 'fs';
import type { Browser } from 'playwright-chromium';

// ---------------------------------------------------------------------------
// Centralised Chromium launcher for every server-side PDF/render task.
//
// Why this exists: Playwright's BUNDLED Chromium is a glibc build and will NOT
// run on the Alpine (musl) production image — and the image never runs
// `playwright install` either, so the bundled browser is simply absent
// (ENOENT: .../chrome-headless-shell at launch). In the container we instead
// `apk add chromium` and point Playwright at that system binary via
// executablePath. Locally (dev) there is no system chromium but the bundled
// browser IS present, so we return undefined and let Playwright use its own.
//
// The path is probed at RUNTIME (existsSync) across a candidate list so the
// same code works in the Alpine container, on a glibc host, and in local dev
// without any per-environment branching. CHROMIUM_PATH overrides the list.
// ---------------------------------------------------------------------------

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,      // explicit override (set in the Docker image)
  '/usr/bin/chromium-browser',    // Alpine `chromium` package
  '/usr/bin/chromium',            // Debian/other
].filter((p): p is string => !!p);

function resolveChromiumPath(): string | undefined {
  for (const p of CHROMIUM_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return undefined; // fall back to Playwright's bundled browser (local dev)
}

export async function launchChromium(opts: { args?: string[] } = {}): Promise<Browser> {
  const { chromium } = await import('playwright-chromium');
  return chromium.launch({
    executablePath: resolveChromiumPath(),
    // --no-sandbox: containers run as root with no user namespaces.
    // --disable-dev-shm-usage: /dev/shm is tiny in Docker and Chromium crashes
    // writing there — force it to use /tmp instead.
    args: ['--no-sandbox', '--disable-dev-shm-usage', ...(opts.args ?? [])],
  });
}
