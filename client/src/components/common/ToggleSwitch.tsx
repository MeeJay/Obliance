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
 * to represent booleans. Accessible, keyboard-friendly, and respects the
 * theme (accent color when on, bg-tertiary border when off).
 */
export function ToggleSwitch({
  checked, onChange, disabled = false, size = 'md', label, description, title,
}: Props) {
  const dims = size === 'sm'
    ? { track: 'w-8 h-4', knob: 'w-3 h-3', on: 'translate-x-4', off: 'translate-x-0.5', top: 'top-0.5' }
    : { track: 'w-10 h-5', knob: 'w-4 h-4', on: 'translate-x-5', off: 'translate-x-0.5', top: 'top-0.5' };

  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked); }}
      title={title}
      className={clsx(
        'relative rounded-full transition-colors shrink-0',
        dims.track,
        checked ? 'bg-accent' : 'bg-bg-tertiary border border-border',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        className={clsx(
          'absolute rounded-full bg-white transition-transform',
          dims.knob,
          dims.top,
          checked ? dims.on : dims.off,
        )}
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
