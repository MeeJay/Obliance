import { cn } from '@/utils/cn';

interface PeriodSelectorProps {
  value: string;
  onChange: (period: string) => void;
}

const PERIODS = [
  { value: '1h', label: '1H' },
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '365d', label: '1Y' },
];

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={cn(
            'px-3 py-1 text-xs font-medium transition-colors',
            value === p.value
              ? 'bg-accent text-white'
              : 'bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-bg-hover',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
