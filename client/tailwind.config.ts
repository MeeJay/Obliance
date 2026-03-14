import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Obliance dark theme palette
        bg: {
          primary: '#0d1117',
          secondary: '#161b22',
          tertiary: '#1c2333',
          hover: '#21262d',
          active: '#282e38',
        },
        border: {
          DEFAULT: '#30363d',
          light: '#3d444d',
        },
        text: {
          primary: '#e6edf3',
          secondary: '#8b949e',
          muted: '#6e7681',
        },
        status: {
          up: '#2ea043',
          'up-bg': '#0d2818',
          down: '#f85149',
          'down-bg': '#3d1418',
          pending: '#d29922',
          'pending-bg': '#2e2111',
          maintenance: '#58a6ff',
          'maintenance-bg': '#0d2546',
          paused: '#8b949e',
          'paused-bg': '#1c2333',
          'ssl-warning': '#d29922',
          'ssl-warning-bg': '#2e2111',
          'ssl-expired': '#a371f7',
          'ssl-expired-bg': '#271a45',
        },
        accent: {
          DEFAULT: '#58a6ff',
          hover: '#79c0ff',
          dark: '#1f6feb',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Noto Sans',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
