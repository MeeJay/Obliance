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
    // noVNC uses top-level await internally — requires ES2022+ target
    target: 'esnext',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true, // proxy WebSocket upgrades (needed for VNC tunnel)
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});
