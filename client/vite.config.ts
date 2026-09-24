import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const { version: clientVersion } = JSON.parse(
  readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'),
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(clientVersion),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@obliance/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  build: {
    // Syntax target (no polyfills) = Vite's "modules" baseline: the oldest
    // engines Vite supports without @vitejs/plugin-legacy. 'esnext' shipped
    // whatever syntax src/ and deps contain untransformed, so an old or
    // non-updatable Android System WebView (Android app, docs/obli-mobile.md)
    // could fail to PARSE the single bundle: white screen, no way to recover.
    // Lower buys nothing: the Tailwind layout already needs flex `gap` (Chrome 84).
    // 'esnext' was set for @novnc/novnc (top-level await), no longer imported.
    // If a top-level await ever comes back, the build fails loudly: then add
    // `esbuild: { supported: { 'top-level-await': true } }` (Chrome 89+)
    // instead of going back to 'esnext'.
    target: ['es2020', 'chrome87', 'edge88', 'firefox78', 'safari14'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true, // proxy WebSocket upgrades (needed for remote tunnels)
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});
