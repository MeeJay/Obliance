import { clsx } from 'clsx';

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label?: React.ReactNode;
  description?: React.ReactNode;
  title?: string;
}

/**
 * iOS-style toggle switch. Drop-in replacement for checkbox inputs used
 * to represent booleans. Accessible (role="switch", aria-checked).
 *
 * Positioning is done with inline styles rather than Tailwind utility
 * classes to avoid ambiguous absolute-anchoring bugs where the knob ends
 * up at the wrong edge of the track.
 */
export function ToggleSwitch({
  checked, onChange, disabled = false, size = 'md', label, description, title,
}: Props) {
  // Geometry (px). Chosen so the knob has a 2px visual padding from the
  // track edge in both OFF and ON positions.
  const G = size === 'sm'
    ? { trackW: 32, trackH: 16, knob: 12, pad: 2 }
    : { trackW: 40, trackH: 20, knob: 16, pad: 2 };
  const translateX = checked ? G.trackW - G.knob - G.pad : G.pad;

  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked); }}
      title={title}
      style={{ width: G.trackW, height: G.trackH }}
      className={clsx(
        'relative rounded-full transition-colors shrink-0 border',
        checked ? 'bg-accent border-accent' : 'bg-bg-tertiary border-border',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        className="absolute rounded-full bg-white shadow-sm transition-transform"
        style={{
          top: (G.trackH - G.knob) / 2 - 1, // -1 to compensate for the 1px border
          left: 0,
          width: G.knob,
          height: G.knob,
          transform: `translateX(${translateX}px)`,
        }}
      />
    </button>
  );

  if (!label && !description) return toggle;

  return (
    <label className={clsx('flex items-start gap-2.5', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
      {toggle}
      <span className="flex flex-col min-w-0">
        {label && <span className="text-sm text-text-primary">{label}</span>}
        {description && <span className="text-xs text-text-muted">{description}</span>}
      </span>
    </label>
  );
}
