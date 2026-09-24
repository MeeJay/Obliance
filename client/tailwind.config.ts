import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  // docs/obli-mobile.md §4 — `hover:` / `group-hover:` only apply on devices
  // that really hover (mouse / trackpad), so hover styles no longer "stick"
  // after a tap on touch screens. Desktop output is unchanged.
  future: {
    hoverOnlyWhenSupported: true,
  },
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
        // Obli Suite brand palette — used by the topbar app switcher
        // and the per-app active-pill highlight. Values fixed per
        // docs/obli-design-system.md §1; not theme-swappable so the
        // dot colours stay recognisable across every theme.
        obli: {
          view:   '#2bc4bd',
          guard:  '#f5a623',
          map:    '#1edd8a',
          ance:   '#e03a3a',
          ance2:  '#ff6868',
          hub:    '#2d4ec9',
        },
      },
      fontFamily: {
        // Obli Design v1 — Rajdhani is a CONDENSED display font; it's beautiful
        // at 24+px (page titles, hero KPIs) but blurry/unreadable at 12-13px
        // body sizes. So:
        //   font-sans     → Inter / system stack for body, nav, table rows
        //   font-display  → Rajdhani for headings + hero values (use class)
        //   font-mono     → JetBrains Mono for IDs / counts / timestamps
        // Fallback chain stays native so Google Fonts failures don't blank UI.
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Noto Sans',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        display: [
          'Rajdhani',
          'Inter',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      // Sheet / drawer entrance animations used by components/common/Modal
      // and Drawer (docs/obli-mobile.md §8). Opt-in classes only.
      keyframes: {
        'obli-fade-in':        { from: { opacity: '0' }, to: { opacity: '1' } },
        'obli-slide-in-left':  { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'obli-slide-in-right': { from: { transform: 'translateX(100%)' },  to: { transform: 'translateX(0)' } },
        'obli-slide-in-up':    { from: { transform: 'translateY(100%)' },  to: { transform: 'translateY(0)' } },
      },
      animation: {
        'obli-fade-in':        'obli-fade-in 150ms ease-out',
        'obli-slide-in-left':  'obli-slide-in-left 200ms ease-out',
        'obli-slide-in-right': 'obli-slide-in-right 200ms ease-out',
        'obli-slide-in-up':    'obli-slide-in-up 200ms ease-out',
      },
    },
  },
  plugins: [
    // docs/obli-mobile.md §4 — input-capability variants.
    //   coarse:     → @media (pointer: coarse)          (touch: bigger targets)
    //   can-hover:  → @media (hover: hover) and (pointer: fine)
    //                 (things that must only exist with a mouse, e.g.
    //                  `can-hover:opacity-0 can-hover:group-hover:opacity-100`)
    // Declared as plugin variants rather than `theme.screens` raw entries on
    // purpose: object screens make Tailwind disable every `max-*` / `min-*`
    // variant (and drop screen sorting). Default breakpoints are untouched.
    plugin(({ addVariant }) => {
      addVariant('coarse', '@media (pointer: coarse)');
      addVariant('can-hover', '@media (hover: hover) and (pointer: fine)');
    }),
  ],
} satisfies Config;
