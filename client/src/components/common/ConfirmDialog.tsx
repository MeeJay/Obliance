import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Modal } from './Modal';

/**
 * Promise-based replacements for window.confirm / window.prompt —
 * docs/obli-mobile.md §5.6 / §8. (window.confirm/prompt silently return
 * false/null in an Android WebView without a WebChromeClient, and are
 * unstyled + untranslatable everywhere else.)
 *
 * Mount <ConfirmProvider /> once (App.tsx does it). Then:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ message: t('x.deleteConfirm'), danger: true }))) return;
 *
 *   const prompt = usePrompt();
 *   const name = await prompt({ title: t('x.rename'), defaultValue: row.name });
 *   if (name === null) return;
 *
 * Outside React components: `await confirmDialog({...})` / `await promptDialog({...})`.
 */

export interface ConfirmOptions {
  title?: ReactNode;
  message: ReactNode;
  /** Default: t('common.confirm') — or t('common.delete') when `danger`. */
  confirmLabel?: string;
  /** Default: t('common.cancel'). */
  cancelLabel?: string;
  /** Red confirm button + warning icon; initial focus goes to Cancel. */
  danger?: boolean;
  /** Type-to-confirm: the confirm button stays disabled until the user types exactly this text. */
  requireText?: string;
}

export interface PromptOptions {
  title?: ReactNode;
  message?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  /** Default: t('common.confirm'). */
  confirmLabel?: string;
  /** Default: t('common.cancel'). */
  cancelLabel?: string;
  /** Textarea instead of a single-line input (Ctrl/Cmd+Enter submits). */
  multiline?: boolean;
  /** Disable the confirm button while the (trimmed) value is empty. */
  required?: boolean;
  /** Input type for single-line prompts (default 'text'). */
  inputType?: 'text' | 'number' | 'email' | 'url' | 'password';
  /** Turns off autocapitalize / autocorrect / spellcheck (identifiers, paths, IPs). Default true. */
  plain?: boolean;
}

type Request =
  | { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

type Enqueue = (r: Request) => void;

let hostEnqueue: Enqueue | null = null;
let requestSeq = 0;

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

/** Imperative confirm (usable anywhere). Falls back to window.confirm if no provider is mounted. */
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options;
  if (!hostEnqueue) {
    const text = [textOf(opts.title), textOf(opts.message)].filter(Boolean).join('\n\n');
    return Promise.resolve(window.confirm(text));
  }
  const enqueue = hostEnqueue;
  return new Promise<boolean>((resolve) => {
    enqueue({ id: ++requestSeq, kind: 'confirm', opts, resolve });
  });
}

/** Imperative prompt (usable anywhere). Resolves null on cancel. Falls back to window.prompt if no provider is mounted. */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  if (!hostEnqueue) {
    const text = [textOf(options.title), textOf(options.message)].filter(Boolean).join('\n\n');
    return Promise.resolve(window.prompt(text, options.defaultValue ?? ''));
  }
  const enqueue = hostEnqueue;
  return new Promise<string | null>((resolve) => {
    enqueue({ id: ++requestSeq, kind: 'prompt', opts: options, resolve });
  });
}

/** Hook form of confirmDialog (stable function). */
export function useConfirm(): (options: ConfirmOptions | string) => Promise<boolean> {
  return confirmDialog;
}

/** Hook form of promptDialog (stable function). */
export function usePrompt(): (options: PromptOptions) => Promise<string | null> {
  return promptDialog;
}

/**
 * Renders the queued confirm / prompt dialogs (one at a time, FIFO). Mount
 * once near the root; `children` are rendered untouched.
 */
export function ConfirmProvider({ children }: { children?: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);

  useEffect(() => {
    const enqueue: Enqueue = (r) => setQueue((q) => [...q, r]);
    hostEnqueue = enqueue;
    return () => {
      if (hostEnqueue === enqueue) hostEnqueue = null;
    };
  }, []);

  const current = queue[0];

  const settle = (value: boolean | string | null) => {
    if (!current) return;
    if (current.kind === 'confirm') current.resolve(value === true);
    else current.resolve(typeof value === 'string' ? value : null);
    setQueue((q) => q.slice(1));
  };

  return (
    <>
      {children}
      {current && <DialogView key={current.id} request={current} onSettle={settle} />}
    </>
  );
}

const btnBase =
  'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 coarse:min-h-11 coarse:px-4';

const inputCls =
  'w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary ' +
  'placeholder:text-text-muted focus:border-accent focus:outline-none';

function DialogView({ request, onSettle }: { request: Request; onSettle: (v: boolean | string | null) => void }) {
  const { t } = useTranslation();
  const isPrompt = request.kind === 'prompt';
  const confirmOpts = request.kind === 'confirm' ? request.opts : null;
  const promptOpts = request.kind === 'prompt' ? request.opts : null;
  const [value, setValue] = useState<string>(promptOpts?.defaultValue ?? '');

  const danger = !!confirmOpts?.danger;
  const requireText = confirmOpts?.requireText;
  const canConfirm = promptOpts
    ? !promptOpts.required || value.trim() !== ''
    : !requireText || value === requireText;

  const cancel = () => onSettle(isPrompt ? null : false);
  const accept = () => {
    if (!canConfirm) return;
    onSettle(isPrompt ? value : true);
  };

  const title = request.opts.title;
  const message = request.opts.message;
  const confirmLabel =
    request.opts.confirmLabel ?? (danger ? t('common.delete', 'Delete') : t('common.confirm', 'Confirm'));
  const cancelLabel = request.opts.cancelLabel ?? t('common.cancel', 'Cancel');
  const plain = promptOpts?.plain ?? true;
  const textProps = plain
    ? { autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, autoComplete: 'off' }
    : {};

  return (
    <Modal
      open
      onClose={cancel}
      title={title}
      size="sm"
      phoneLayout="sheet"
      showCloseButton={false}
      overlayClassName="z-[400]"
      footerClassName="max-sm:[&>*]:flex-1"
      footer={
        <>
          <button
            type="button"
            onClick={cancel}
            autoFocus={danger && !requireText}
            className={cn(btnBase, 'text-text-secondary hover:bg-bg-hover hover:text-text-primary')}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={!canConfirm}
            autoFocus={!isPrompt && !danger && !requireText}
            className={cn(
              btnBase,
              'text-white',
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-accent hover:bg-accent-hover',
            )}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {(message != null || danger) && (
          <div className="flex items-start gap-3">
            {danger && (
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/10">
                <AlertTriangle className="h-4 w-4 text-red-400" />
              </div>
            )}
            {message != null && (
              <div className="min-w-0 flex-1 whitespace-pre-line break-words text-sm text-text-secondary">
                {message}
              </div>
            )}
          </div>
        )}

        {requireText && (
          <div className="space-y-1.5">
            <label className="block text-xs text-text-muted">
              {t('ui.confirm.typeToConfirm', { text: requireText, defaultValue: 'Type "{{text}}" to confirm' })}
            </label>
            <input
              type="text"
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); accept(); }
              }}
              className={cn(inputCls, 'font-mono')}
              {...textProps}
            />
          </div>
        )}

        {promptOpts && (promptOpts.multiline ? (
          <textarea
            value={value}
            autoFocus
            rows={5}
            placeholder={promptOpts.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); accept(); }
            }}
            className={cn(inputCls, 'resize-y')}
            {...textProps}
          />
        ) : (
          <input
            type={promptOpts.inputType ?? 'text'}
            value={value}
            autoFocus
            placeholder={promptOpts.placeholder}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); accept(); }
            }}
            className={inputCls}
            {...textProps}
          />
        ))}
      </div>
    </Modal>
  );
}
