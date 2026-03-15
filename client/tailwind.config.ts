import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // All colors use CSS custom properties so themes can swap them at runtime.
        // CSS vars hold space-separated RGB triplets so Tailwind's opacity modifier
        // syntax (e.g. bg-accent/30) works correctly.
        bg: {
          primary:   'rgb(var(--c-bg-primary)   / <alpha-value>)',
          secondary: 'rgb(var(--c-bg-secondary) / <alpha-value>)',
          tertiary:  'rgb(var(--c-bg-tertiary)  / <alpha-value>)',
          hover:     'rgb(var(--c-bg-hover)     / <alpha-value>)',
          active:    'rgb(var(--c-bg-active)    / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--c-border)       / <alpha-value>)',
          light:   'rgb(var(--c-border-light) / <alpha-value>)',
        },
        text: {
          primary:   'rgb(var(--c-text-primary)   / <alpha-value>)',
          secondary: 'rgb(var(--c-text-secondary) / <alpha-value>)',
          muted:     'rgb(var(--c-text-muted)     / <alpha-value>)',
        },
        status: {
          up:                'rgb(var(--c-status-up)              / <alpha-value>)',
          'up-bg':           'rgb(var(--c-status-up-bg)           / <alpha-value>)',
          down:              'rgb(var(--c-status-down)            / <alpha-value>)',
          'down-bg':         'rgb(var(--c-status-down-bg)         / <alpha-value>)',
          pending:           'rgb(var(--c-status-pending)         / <alpha-value>)',
          'pending-bg':      'rgb(var(--c-status-pending-bg)      / <alpha-value>)',
          maintenance:       'rgb(var(--c-status-maintenance)     / <alpha-value>)',
          'maintenance-bg':  'rgb(var(--c-status-maintenance-bg)  / <alpha-value>)',
          paused:            'rgb(var(--c-status-paused)          / <alpha-value>)',
          'paused-bg':       'rgb(var(--c-status-paused-bg)       / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--c-accent)       / <alpha-value>)',
          hover:   'rgb(var(--c-accent-hover) / <alpha-value>)',
          dark:    'rgb(var(--c-accent-dark)  / <alpha-value>)',
        },
        // Alias used by ThemePicker and interactive components
        primary: 'rgb(var(--c-primary) / <alpha-value>)',
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
