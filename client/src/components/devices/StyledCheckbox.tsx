import { clsx } from 'clsx';

interface StyledCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
}

export function StyledCheckbox({ checked, onChange, indeterminate, disabled, className }: StyledCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={clsx(
        'w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-150 shrink-0',
        checked || indeterminate
          ? 'bg-accent border-accent text-white'
          : 'bg-transparent border-border hover:border-accent/50',
        disabled && 'opacity-40 cursor-not-allowed',
        !disabled && 'cursor-pointer',
        className,
      )}
    >
      {checked && (
        <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6l3 3 5-5" />
        </svg>
      )}
      {indeterminate && !checked && (
        <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <path d="M2 6h8" />
        </svg>
      )}
    </button>
  );
}
