import { useState } from 'react';
import { Keyboard, X, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';

interface Props {
  /** Sends raw bytes to the terminal session. Usually `(s) => ws.send(...)`. */
  onKey: (sequence: string) => void;
  className?: string;
}

// Escape sequences per xterm/vt220 convention. Same as what a real terminal
// emitter would send when the corresponding physical key is pressed.
const FUNCTION_KEYS: Array<{ label: string; seq: string }> = [
  { label: 'F1',  seq: '\x1bOP'    },
  { label: 'F2',  seq: '\x1bOQ'    },
  { label: 'F3',  seq: '\x1bOR'    },
  { label: 'F4',  seq: '\x1bOS'    },
  { label: 'F5',  seq: '\x1b[15~'  },
  { label: 'F6',  seq: '\x1b[17~'  },
  { label: 'F7',  seq: '\x1b[18~'  },
  { label: 'F8',  seq: '\x1b[19~'  },
  { label: 'F9',  seq: '\x1b[20~'  },
  { label: 'F10', seq: '\x1b[21~'  },
  { label: 'F11', seq: '\x1b[23~'  },
  { label: 'F12', seq: '\x1b[24~'  },
];

const CONTROL_KEYS: Array<{ label: string; seq: string; title?: string }> = [
  { label: 'Esc', seq: '\x1b',  title: 'Escape' },
  { label: 'Tab', seq: '\t',    title: 'Tab' },
  { label: '↑',   seq: '\x1b[A', title: 'Up arrow' },
  { label: '↓',   seq: '\x1b[B', title: 'Down arrow' },
  { label: '←',   seq: '\x1b[D', title: 'Left arrow' },
  { label: '→',   seq: '\x1b[C', title: 'Right arrow' },
  { label: 'Home',seq: '\x1bOH', title: 'Home' },
  { label: 'End', seq: '\x1bOF', title: 'End' },
  { label: 'PgUp',seq: '\x1b[5~', title: 'Page Up' },
  { label: 'PgDn',seq: '\x1b[6~', title: 'Page Down' },
  { label: 'Ins', seq: '\x1b[2~', title: 'Insert' },
  { label: 'Del', seq: '\x1b[3~', title: 'Delete' },
];

const CTRL_COMBOS: Array<{ label: string; seq: string; title: string }> = [
  { label: '^C', seq: '\x03', title: 'Ctrl+C — interrupt' },
  { label: '^D', seq: '\x04', title: 'Ctrl+D — EOF / logout' },
  { label: '^Z', seq: '\x1a', title: 'Ctrl+Z — suspend' },
  { label: '^L', seq: '\x0c', title: 'Ctrl+L — clear screen' },
  { label: '^U', seq: '\x15', title: 'Ctrl+U — erase line' },
  { label: '^W', seq: '\x17', title: 'Ctrl+W — erase word' },
  { label: '^R', seq: '\x12', title: 'Ctrl+R — reverse history search' },
  { label: '^A', seq: '\x01', title: 'Ctrl+A — start of line' },
  { label: '^E', seq: '\x05', title: 'Ctrl+E — end of line' },
];

/**
 * Floating panel with virtual terminal keys the browser normally intercepts
 * (F1-F12, arrows, Ctrl combos). Clicking a key injects the corresponding
 * escape sequence into the active terminal session via the provided
 * `onKey` callback.
 */
export function VirtualKeyPanel({ onKey, className }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [section, setSection] = useState<'fn' | 'ctrl' | 'nav'>('fn');

  const renderRow = (keys: Array<{ label: string; seq: string; title?: string }>) => (
    <div className="flex flex-wrap gap-1 p-2">
      {keys.map((k) => (
        <button
          key={k.label}
          type="button"
          onClick={() => onKey(k.seq)}
          title={k.title || k.label}
          className="min-w-[36px] px-2 py-1 text-[11px] font-mono font-semibold bg-bg-tertiary border border-border rounded hover:bg-accent/10 hover:border-accent/40 hover:text-accent transition-colors"
        >
          {k.label}
        </button>
      ))}
    </div>
  );

  return (
    <div
      className={clsx(
        'bg-bg-secondary border-t border-border flex flex-col shrink-0',
        className,
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border/50">
        <Keyboard className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-[11px] text-text-muted uppercase tracking-wider mr-2">Keys</span>
        {!collapsed && (
          <div className="flex items-center gap-1">
            {(['fn', 'nav', 'ctrl'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={clsx(
                  'px-2 py-0.5 text-[10px] font-medium rounded transition-colors',
                  section === s ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary',
                )}
              >
                {s === 'fn' ? 'F1-F12' : s === 'nav' ? 'Nav' : 'Ctrl+'}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto p-0.5 text-text-muted hover:text-text-primary"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>
      {!collapsed && (
        section === 'fn'   ? renderRow(FUNCTION_KEYS) :
        section === 'nav'  ? renderRow(CONTROL_KEYS) :
                             renderRow(CTRL_COMBOS)
      )}
    </div>
  );
}
