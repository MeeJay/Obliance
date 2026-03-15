import { Check } from 'lucide-react';
import type { AppTheme } from '@/utils/theme';
import { clsx } from 'clsx';

interface ThemePickerProps {
  value: AppTheme;
  onChange: (theme: AppTheme) => void;
}

/* ─── SVG mini-dashboard previews ─────────────────────────────────────────── */

function ModernPreviewSvg() {
  // Modern UI : fond très sombre, teinte violette ultra-subtile, accent violet doux
  return (
    <svg viewBox="0 0 280 170" xmlns="http://www.w3.org/2000/svg" className="w-full rounded-md">
      {/* Page background */}
      <rect width="280" height="170" fill="#0c0a12" rx="6" />

      {/* Sidebar */}
      <rect x="0" y="0" width="60" height="170" fill="#13101b" rx="6" />
      <rect x="60" y="0" width="1" height="170" fill="#363048" />
      {/* Sidebar logo */}
      <rect x="10" y="12" width="16" height="16" rx="3" fill="#a78bfa" opacity="0.9" />
      <rect x="31" y="15" width="22" height="5" rx="2" fill="#8c857e" />
      {/* Sidebar nav items */}
      {[40, 62, 84, 106].map((y, i) => (
        <g key={y}>
          <rect x="7" y={y} width="46" height="16" rx="3"
            fill={i === 0 ? '#28233a' : 'transparent'} />
          <rect x="13" y={y + 4} width="8" height="8" rx="2"
            fill={i === 0 ? '#a78bfa' : '#6b657a'} />
          <rect x="25" y={y + 6} width={i === 0 ? 22 : 18} height="4" rx="2"
            fill={i === 0 ? '#e4e0f2' : '#6b657a'} />
        </g>
      ))}

      {/* Top header */}
      <rect x="61" y="0" width="219" height="28" fill="#13101b" />
      <rect x="61" y="28" width="219" height="1" fill="#363048" />
      <rect x="70" y="8" width="50" height="12" rx="3" fill="#0c0a12" />
      <rect x="230" y="9" width="44" height="10" rx="4" fill="#1a1725" stroke="#363048" strokeWidth="0.5" />

      {/* Stats row */}
      {[0, 1, 2, 3].map((i) => {
        const colors = ['#2ea043', '#f85149', '#d29922', '#a78bfa'];
        const labels = [68, 4, 2, 8];
        const x = 70 + i * 52;
        return (
          <g key={i}>
            <rect x={x} y="36" width="44" height="24" rx="4" fill="#13101b" stroke="#363048" strokeWidth="0.5" />
            <rect x={x + 4} y="41" width="6" height="6" rx="3" fill={colors[i]} />
            <rect x={x + 12} y="41" width={labels[i]} height="4" rx="2" fill={colors[i]} opacity="0.7" />
            <rect x={x + 12} y="48" width="20" height="3" rx="2" fill="#6b657a" />
          </g>
        );
      })}

      {/* Device cards */}
      {[0, 1, 2].map((i) => {
        const statusColors = ['#2ea043', '#f85149', '#2ea043'];
        const x = 70 + i * 69;
        return (
          <g key={i}>
            <rect x={x} y="68" width="62" height="50" rx="4" fill="#13101b" stroke="#363048" strokeWidth="0.5" />
            <rect x={x} y="68" width="2.5" height="50" rx="2" fill={statusColors[i]} />
            <rect x={x + 7} y="76" width="6" height="6" rx="3" fill={statusColors[i]} />
            <rect x={x + 17} y="77" width={i === 1 ? 30 : 35} height="4" rx="2" fill="#e4e0f2" />
            <rect x={x + 17} y="84" width="25" height="3" rx="2" fill="#6b657a" />
            {i === 1 ? (
              <polyline
                points={`${x+7},102 ${x+12},106 ${x+17},100 ${x+22},108 ${x+27},103 ${x+32},109 ${x+37},104 ${x+42},107 ${x+47},103 ${x+52},108 ${x+57},105`}
                fill="none" stroke="#f85149" strokeWidth="1.2" opacity="0.8"
              />
            ) : (
              <polyline
                points={`${x+7},104 ${x+12},101 ${x+17},103 ${x+22},99 ${x+27},101 ${x+32},98 ${x+37},100 ${x+42},97 ${x+47},99 ${x+52},96 ${x+57},98`}
                fill="none" stroke="#2ea043" strokeWidth="1.2" opacity="0.8"
              />
            )}
            <rect x={x + 7} y="110" width="18" height="3" rx="2" fill="#8c857e" />
            <rect x={x + 40} y="110" width="15" height="3" rx="2" fill={statusColors[i]} opacity="0.8" />
          </g>
        );
      })}

      {/* Bottom card with progress bars */}
      <rect x="70" y="126" width="200" height="36" rx="4" fill="#13101b" stroke="#363048" strokeWidth="0.5" />
      <rect x="78" y="132" width="5" height="5" rx="2.5" fill="#2ea043" />
      <rect x="87" y="133" width="35" height="4" rx="2" fill="#e4e0f2" />
      <rect x="78" y="143" width="90" height="3" rx="2" fill="#1a1725" />
      <rect x="78" y="143" width="55" height="3" rx="2" fill="#a78bfa" opacity="0.85" />
      <rect x="175" y="143" width="88" height="3" rx="2" fill="#1a1725" />
      <rect x="175" y="143" width="40" height="3" rx="2" fill="#7c3aed" opacity="0.85" />
    </svg>
  );
}

function NeonPreviewSvg() {
  // Neon UI : violet électrique avec effets de glow
  return (
    <svg viewBox="0 0 280 170" xmlns="http://www.w3.org/2000/svg" className="w-full rounded-md">
      <defs>
        <filter id="glow-violet" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-green" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-red" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Page background — near-black with violet tint */}
      <rect width="280" height="170" fill="#07050c" rx="6" />

      {/* Sidebar */}
      <rect x="0" y="0" width="60" height="170" fill="#0c0914" rx="6" />
      <rect x="60" y="0" width="1" height="#342355" />
      <line x1="60" y1="0" x2="60" y2="170" stroke="#342355" strokeWidth="1" />
      {/* Sidebar logo — neon violet */}
      <rect x="10" y="12" width="16" height="16" rx="3" fill="#c084fc" opacity="0.9" filter="url(#glow-violet)" />
      <rect x="31" y="15" width="22" height="5" rx="2" fill="#9b80c8" />
      {/* Sidebar nav items */}
      {[40, 62, 84, 106].map((y, i) => (
        <g key={y}>
          {/* Active item (i=0) has left border glow */}
          {i === 0 && (
            <rect x="7" y={y} width="3" height="16" rx="1.5"
              fill="#c084fc" filter="url(#glow-violet)" />
          )}
          <rect x="10" y={y} width="43" height="16" rx="3"
            fill={i === 0 ? 'rgba(192,132,252,0.12)' : 'transparent'} />
          <rect x="13" y={y + 4} width="8" height="8" rx="2"
            fill={i === 0 ? '#c084fc' : '#6c5594'}
            filter={i === 0 ? 'url(#glow-violet)' : undefined} />
          <rect x="25" y={y + 6} width={i === 0 ? 22 : 18} height="4" rx="2"
            fill={i === 0 ? '#c084fc' : '#6c5594'}
            filter={i === 0 ? 'url(#glow-violet)' : undefined} />
        </g>
      ))}

      {/* Top header */}
      <rect x="61" y="0" width="219" height="28" fill="#0c0914" />
      {/* Header bottom glow line */}
      <line x1="61" y1="28" x2="280" y2="28" stroke="url(#headerGlow)" strokeWidth="1" />
      <defs>
        <linearGradient id="headerGlow" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="transparent" />
          <stop offset="30%" stopColor="rgba(192,132,252,0.15)" />
          <stop offset="50%" stopColor="rgba(192,132,252,0.8)" />
          <stop offset="70%" stopColor="rgba(192,132,252,0.15)" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <rect x="70" y="8" width="50" height="12" rx="3" fill="#07050c" />
      <rect x="230" y="9" width="44" height="10" rx="4" fill="#110d1c" stroke="#342355" strokeWidth="0.5" />

      {/* Stats row */}
      {[0, 1, 2, 3].map((i) => {
        const colors   = ['#00dc6e', '#ff3860', '#ffbe00', '#c084fc'];
        const filters  = ['url(#glow-green)', 'url(#glow-red)', undefined, 'url(#glow-violet)'];
        const labels   = [68, 4, 2, 8];
        const x = 70 + i * 52;
        return (
          <g key={i}>
            <rect x={x} y="36" width="44" height="24" rx="4" fill="#0c0914" stroke="#342355" strokeWidth="0.5" />
            <rect x={x + 4} y="41" width="6" height="6" rx="3" fill={colors[i]} filter={filters[i]} />
            <rect x={x + 12} y="41" width={labels[i]} height="4" rx="2" fill={colors[i]} opacity="0.75" />
            <rect x={x + 12} y="48" width="20" height="3" rx="2" fill="#6c5594" />
          </g>
        );
      })}

      {/* Device cards */}
      {[0, 1, 2].map((i) => {
        const statusColors  = ['#00dc6e', '#ff3860', '#00dc6e'];
        const statusFilters = ['url(#glow-green)', 'url(#glow-red)', 'url(#glow-green)'];
        const x = 70 + i * 69;
        return (
          <g key={i}>
            <rect x={x} y="68" width="62" height="50" rx="4" fill="#0c0914" stroke="#342355" strokeWidth="0.5" />
            {/* Status left border with glow */}
            <rect x={x} y="68" width="2.5" height="50" rx="2" fill={statusColors[i]} filter={statusFilters[i]} />
            <rect x={x + 7} y="76" width="6" height="6" rx="3" fill={statusColors[i]} filter={statusFilters[i]} />
            <rect x={x + 17} y="77" width={i === 1 ? 30 : 35} height="4" rx="2" fill="#ece4ff" />
            <rect x={x + 17} y="84" width="25" height="3" rx="2" fill="#6c5594" />
            {i === 1 ? (
              <polyline
                points={`${x+7},102 ${x+12},106 ${x+17},100 ${x+22},108 ${x+27},103 ${x+32},109 ${x+37},104 ${x+42},107 ${x+47},103 ${x+52},108 ${x+57},105`}
                fill="none" stroke="#ff3860" strokeWidth="1.3" opacity="0.9"
                filter="url(#glow-red)"
              />
            ) : (
              <polyline
                points={`${x+7},104 ${x+12},101 ${x+17},103 ${x+22},99 ${x+27},101 ${x+32},98 ${x+37},100 ${x+42},97 ${x+47},99 ${x+52},96 ${x+57},98`}
                fill="none" stroke="#00dc6e" strokeWidth="1.3" opacity="0.9"
                filter="url(#glow-green)"
              />
            )}
            <rect x={x + 7} y="110" width="18" height="3" rx="2" fill="#9b80c8" />
            <rect x={x + 40} y="110" width="15" height="3" rx="2" fill={statusColors[i]} opacity="0.8" />
          </g>
        );
      })}

      {/* Bottom card with neon progress bars */}
      <rect x="70" y="126" width="200" height="36" rx="4" fill="#0c0914" stroke="#342355" strokeWidth="0.5" />
      <rect x="78" y="132" width="5" height="5" rx="2.5" fill="#00dc6e" filter="url(#glow-green)" />
      <rect x="87" y="133" width="35" height="4" rx="2" fill="#ece4ff" />
      <rect x="78" y="143" width="90" height="3" rx="2" fill="#110d1c" />
      <rect x="78" y="143" width="55" height="3" rx="2" fill="#c084fc" opacity="0.95" filter="url(#glow-violet)" />
      <rect x="175" y="143" width="88" height="3" rx="2" fill="#110d1c" />
      <rect x="175" y="143" width="40" height="3" rx="2" fill="#9333ea" opacity="0.9" />
    </svg>
  );
}

/* ─── ThemePicker ──────────────────────────────────────────────────────────── */

const THEMES: { id: AppTheme; label: string; Preview: () => JSX.Element }[] = [
  { id: 'modern', label: 'Modern UI', Preview: ModernPreviewSvg },
  { id: 'neon',   label: 'Neon UI',   Preview: NeonPreviewSvg },
];

export function ThemePicker({ value, onChange }: ThemePickerProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {THEMES.map(({ id, label, Preview }) => {
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={clsx(
              'group relative rounded-xl border-2 p-2 text-left transition-all',
              selected
                ? 'border-primary shadow-[0_0_0_1px_rgb(var(--c-primary)/0.3)]'
                : 'border-border hover:border-primary/40 hover:bg-bg-hover',
            )}
          >
            {/* Preview SVG */}
            <div className={clsx(
              'overflow-hidden rounded-lg ring-0 transition-all',
              selected ? 'ring-2 ring-primary/30' : 'group-hover:ring-1 group-hover:ring-primary/20',
            )}>
              <Preview />
            </div>

            {/* Label + checkmark */}
            <div className="mt-2.5 flex items-center justify-between px-1 pb-0.5">
              <span className={clsx(
                'text-sm font-semibold',
                selected ? 'text-primary' : 'text-text-secondary',
              )}>
                {label}
              </span>
              {selected && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                  <Check size={11} className="text-bg-primary" strokeWidth={3} />
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
