import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Shield, Paperclip, Minus } from 'lucide-react';
import { clsx } from 'clsx';
import { getSocket } from '@/socket/socketClient';
import { useAuthStore } from '@/store/authStore';

export interface ChatMessage {
  sender: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

interface ChatPanelProps {
  deviceUuid: string;
  sessionId?: number;
  operatorName: string;
  onClose: () => void;
  onRemoteAccessGranted?: () => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  chatId: string | null;
  setChatId: React.Dispatch<React.SetStateAction<string | null>>;
  /** Controlled from the viewer toolbar — when false, incoming message sounds are muted */
  soundEnabled?: boolean;
  /** Operator's personal quick replies from their profile */
  personalQuickReplies?: string[];
  /** Admin-defined multilingual templates for the tenant */
  adminTemplates?: Array<{ id: number; translations: Record<string, string> }>;
}

let audioCtx: AudioContext | null = null;
function playNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.stop(audioCtx.currentTime + 0.3);
  } catch {}
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name: string) {
  return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// Default operator avatar SVG (red person icon)
function OperatorAvatar({ avatarUrl, size = 28 }: { avatarUrl?: string | null; size?: number }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <div className="rounded-full bg-accent flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg className="text-white" style={{ width: size * 0.55, height: size * 0.55 }} fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
      </svg>
    </div>
  );
}

export function ChatPanel({
  deviceUuid,
  sessionId,
  operatorName,
  onClose,
  onRemoteAccessGranted,
  messages,
  setMessages,
  chatId,
  setChatId,
  soundEnabled: soundEnabledProp = true,
  personalQuickReplies = [],
  adminTemplates = [],
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [userClosed, setUserClosed] = useState(false); // user closed their side but operator can still send
  const [remoteRequested, setRemoteRequested] = useState(false);
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);

  // Get operator's avatar from auth store
  const operatorAvatar = useAuthStore.getState().user?.avatar || null;

  const [templateLang, setTemplateLang] = useState(useAuthStore.getState().user?.preferredLanguage || 'en');

  // Merge personal quick replies + admin templates in selected language
  const adminRepliesInLang = adminTemplates
    .map(t => t.translations[templateLang])
    .filter(Boolean);
  const allQuickReplies = [
    ...personalQuickReplies,
    ...adminRepliesInLang,
  ];

  const templateLanguages = [
    { code: 'en', name: 'English' }, { code: 'fr', name: 'Français' },
    { code: 'es', name: 'Español' }, { code: 'de', name: 'Deutsch' },
    { code: 'pt', name: 'Português' }, { code: 'zh', name: '中文' },
    { code: 'ja', name: '日本語' }, { code: 'ko', name: '한국어' },
    { code: 'ru', name: 'Русский' }, { code: 'ar', name: 'العربية' },
    { code: 'it', name: 'Italiano' }, { code: 'nl', name: 'Nederlands' },
    { code: 'pl', name: 'Polski' }, { code: 'tr', name: 'Türkçe' },
    { code: 'sv', name: 'Svenska' }, { code: 'da', name: 'Dansk' },
    { code: 'cs', name: 'Čeština' }, { code: 'uk', name: 'Українська' },
  ];
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Open chat session
  useEffect(() => {
    const socket = getSocket();
    if (!socket || chatId) return;
    socket.emit('chat:open', { deviceUuid, sessionId, operatorName }, (res: { chatId?: string; error?: string }) => {
      if (res?.chatId) {
        setChatId(res.chatId);
        setIsConnected(true);
        socket.emit('join', `chat:${res.chatId}`);
      } else {
        setMessages(prev => [...prev, {
          sender: 'System', text: `Failed to open chat: ${res?.error || 'agent offline'}`,
          timestamp: Date.now(), isSystem: true,
        }]);
      }
    });
    const timeout = setTimeout(() => {
      if (!chatId) {
        setMessages(prev => {
          if (prev.some(m => m.text.includes('Failed to open'))) return prev;
          return [...prev, { sender: 'System', text: 'Chat connection timed out.', timestamp: Date.now(), isSystem: true }];
        });
      }
    }, 5000);
    return () => { clearTimeout(timeout); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Socket.io listeners
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !chatId) return;
    socket.emit('join', `chat:${chatId}`);

    const onMessage = (data: { chatId: string; sender: string; message: string; timestamp: number }) => {
      if (data.chatId !== chatId) return;
      setMessages(prev => [...prev, { sender: data.sender, text: data.message, timestamp: data.timestamp }]);
      if (soundEnabledProp) playNotificationSound();
      setIsTyping(false);
      // If user had closed and we sent a message that reopened, mark as connected again
      if (userClosed) setUserClosed(false);
    };
    const onClosed = (data: { chatId: string }) => {
      if (data.chatId !== chatId) return;
      setMessages(prev => [...prev, {
        sender: 'System',
        text: 'The user has closed the chat. You can still send messages — the chat will reopen on their screen.',
        timestamp: Date.now(), isSystem: true,
      }]);
      // Do NOT set isConnected=false — operator can still send
      setUserClosed(true);
    };
    const onRemoteResponse = (data: { chatId: string; allowed: boolean }) => {
      if (data.chatId !== chatId) return;
      setRemoteRequested(false);
      setMessages(prev => [...prev, {
        sender: 'System',
        text: data.allowed ? 'Remote control access granted.' : 'Remote control access denied.',
        timestamp: Date.now(), isSystem: true,
      }]);
      if (data.allowed) onRemoteAccessGranted?.();
    };

    socket.on('chat:message', onMessage);
    socket.on('chat:closed', onClosed);
    socket.on('chat:remote_response', onRemoteResponse);
    return () => { socket.off('chat:message', onMessage); socket.off('chat:closed', onClosed); socket.off('chat:remote_response', onRemoteResponse); };
  }, [chatId, setChatId, setMessages, onRemoteAccessGranted, soundEnabledProp, userClosed]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !chatId) return;
    const socket = getSocket();
    if (!socket) return;
    setMessages(prev => [...prev, { sender: operatorName, text: input.trim(), timestamp: Date.now() }]);
    socket.emit('chat:message', { chatId, message: input.trim(), operatorName });
    setInput('');
    inputRef.current?.focus();
  }, [input, chatId, operatorName, setMessages]);

  const handleFileSend = useCallback(async (file: File) => {
    if (!chatId || !isConnected) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessages(prev => [...prev, { sender: 'System', text: 'File too large (max 5 MB)', timestamp: Date.now(), isSystem: true }]);
      return;
    }
    setUploadProgress(`Sending ${file.name}...`);
    try {
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const socket = getSocket();
      if (socket) {
        socket.emit('chat:file', { chatId, fileName: file.name, fileSize: file.size, fileData: b64 });
        setMessages(prev => [...prev, { sender: operatorName, text: `📎 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, timestamp: Date.now() }]);
      }
    } catch {
      setMessages(prev => [...prev, { sender: 'System', text: 'Failed to send file', timestamp: Date.now(), isSystem: true }]);
    } finally { setUploadProgress(null); }
  }, [chatId, isConnected, operatorName, setMessages]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSend(file);
  }, [handleFileSend]);

  const handleClose = useCallback(() => {
    const socket = getSocket();
    if (socket && chatId) socket.emit('chat:close', { chatId });
    onClose();
  }, [chatId, onClose]);

  const handleRequestRemote = useCallback(() => {
    const socket = getSocket();
    if (!socket || !chatId) return;
    socket.emit('chat:request_remote', { chatId, message: requestMessage });
    setRemoteRequested(true);
    setShowRequestDialog(false);
    setMessages(prev => [...prev, { sender: 'System', text: 'Remote control request sent.', timestamp: Date.now(), isSystem: true }]);
  }, [chatId, requestMessage, setMessages]);

  // Can the operator send? Yes, even if user closed their side
  const canSend = isConnected || userClosed;

  if (isMinimized) {
    return (
      <button onClick={() => setIsMinimized(false)}
        className="fixed bottom-6 right-6 z-[60] w-14 h-14 rounded-full bg-accent shadow-lg shadow-accent/30 flex items-center justify-center hover:scale-105 transition-transform">
        <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
      </button>
    );
  }

  return (
    <div
      className="flex flex-col overflow-hidden bg-bg-secondary border border-border rounded-2xl"
      style={{ width: 380, maxHeight: 'calc(100vh - 120px)', height: 600 }}
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-10 bg-accent/20 border-2 border-dashed border-accent flex items-center justify-center rounded-2xl">
          <span className="text-accent font-medium">Drop file to send</span>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0 border-b border-border">
        <OperatorAvatar avatarUrl={operatorAvatar} size={40} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-primary truncate">Obliance Support</div>
          <div className="flex items-center gap-1.5">
            <span className={clsx('w-2 h-2 rounded-full', isConnected && !userClosed ? 'bg-green-400' : userClosed ? 'bg-yellow-400' : 'bg-gray-500')} />
            <span className="text-[11px] text-text-muted">
              {isConnected && !userClosed ? 'En ligne' : userClosed ? 'User disconnected' : 'Hors ligne'}
            </span>
          </div>
        </div>
        <button onClick={() => setIsMinimized(true)} className="p-1.5 text-text-muted hover:text-text-primary transition-colors">
          <Minus className="w-4 h-4" />
        </button>
        <button onClick={handleClose} className="p-1.5 text-text-muted hover:text-red-400 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3 scrollbar-thin scrollbar-thumb-white/10">
        {messages.map((msg, i) => {
          const isOp = msg.sender === operatorName;
          const showTimestamp = i === 0 || (msg.timestamp - messages[i - 1].timestamp > 300_000);

          return (
            <div key={i}>
              {showTimestamp && (
                <div className="text-center py-2">
                  <span className="text-[10px] text-text-muted bg-bg-tertiary px-3 py-1 rounded-full">
                    {new Date(msg.timestamp).toLocaleDateString([], { weekday: 'long' })}, {formatTime(msg.timestamp)}
                  </span>
                </div>
              )}
              {msg.isSystem ? (
                <div className="text-center py-1">
                  <span className="text-[11px] text-yellow-400/80 bg-yellow-400/10 px-3 py-1 rounded-full">{msg.text}</span>
                </div>
              ) : (
                <div className={clsx('flex gap-2', isOp ? 'justify-start' : 'justify-end')}>
                  {isOp && <OperatorAvatar avatarUrl={operatorAvatar} size={28} />}
                  <div className={clsx(
                    'max-w-[75%] px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed',
                    isOp ? 'bg-accent text-white rounded-bl-md' : 'bg-bg-tertiary text-text-primary rounded-br-md'
                  )}>
                    {msg.text}
                  </div>
                  {!isOp && (
                    <div className="w-7 h-7 rounded-full bg-bg-hover flex items-center justify-center shrink-0 mt-auto text-[10px] font-bold text-text-secondary">
                      {getInitials(msg.sender)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {isTyping && (
          <div className="flex gap-2 items-end">
            <OperatorAvatar avatarUrl={operatorAvatar} size={28} />
            <div className="bg-accent px-4 py-2.5 rounded-2xl rounded-bl-md">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Request Remote Control dialog ── */}
      {showRequestDialog && (
        <div className="px-4 py-3 border-t border-border bg-bg-tertiary space-y-2">
          <p className="text-[11px] text-text-muted">Custom message (optional):</p>
          <input value={requestMessage} onChange={e => setRequestMessage(e.target.value)}
            placeholder="e.g., I need to check your settings..."
            className="w-full px-3 py-2 text-xs bg-bg-primary border border-border rounded-lg text-text-primary placeholder-text-muted" />
          <div className="flex gap-2">
            <button onClick={handleRequestRemote}
              className="flex-1 px-3 py-2 text-xs bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors font-medium">
              Send Request
            </button>
            <button onClick={() => setShowRequestDialog(false)}
              className="px-3 py-2 text-xs bg-bg-hover text-text-secondary rounded-lg hover:text-text-primary transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Bottom bar ── */}
      <div className="shrink-0 px-4 py-3 space-y-2">
        {canSend && !remoteRequested && !showRequestDialog && !userClosed && (
          <button onClick={() => setShowRequestDialog(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] bg-accent/10 text-accent border border-accent/20 rounded-xl hover:bg-accent/20 transition-colors font-medium">
            <Shield className="w-3.5 h-3.5" />
            Request Remote Control
          </button>
        )}
        {remoteRequested && (
          <div className="text-[11px] text-center text-yellow-400/80 py-1">Waiting for user response...</div>
        )}
        {uploadProgress && (
          <div className="text-[11px] text-center text-accent py-1 animate-pulse">{uploadProgress}</div>
        )}

        {/* User closed banner */}
        {userClosed && (
          <div className="text-[10px] text-center text-yellow-400/60 py-0.5">
            User disconnected — your message will reopen the chat on their screen
          </div>
        )}

        {/* Quick replies */}
        {showTemplates && (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {/* Language selector for admin templates */}
            {adminTemplates.length > 0 && (
              <select value={templateLang} onChange={e => setTemplateLang(e.target.value)}
                className="w-full px-2 py-1 text-[11px] bg-bg-primary border border-border rounded-lg text-text-secondary mb-1">
                {templateLanguages.map(l => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </select>
            )}
            {personalQuickReplies.length > 0 && (
              <div className="text-[9px] text-text-muted uppercase tracking-wider px-1">Personal</div>
            )}
            {personalQuickReplies.map((t, i) => (
              <button key={`p-${i}`} onClick={() => { setInput(t); setShowTemplates(false); inputRef.current?.focus(); }}
                className="w-full text-left px-3 py-1.5 text-[11px] bg-bg-hover text-text-secondary rounded-lg hover:bg-accent/15 hover:text-text-primary truncate transition-colors">
                {t}
              </button>
            ))}
            {adminRepliesInLang.length > 0 && (
              <div className="text-[9px] text-text-muted uppercase tracking-wider px-1 pt-1">Templates</div>
            )}
            {adminRepliesInLang.map((t, i) => (
              <button key={`t-${i}`} onClick={() => { setInput(t); setShowTemplates(false); inputRef.current?.focus(); }}
                className="w-full text-left px-3 py-1.5 text-[11px] bg-accent/10 text-text-secondary rounded-lg hover:bg-accent/20 hover:text-text-primary truncate transition-colors">
                {t}
              </button>
            ))}
            {allQuickReplies.length === 0 && (
              <div className="text-[11px] text-text-muted text-center py-2 italic">No quick replies configured</div>
            )}
          </div>
        )}

        {/* Input area */}
        <div className="flex items-center gap-2 bg-bg-primary border border-border rounded-2xl px-3 py-1.5">
          <button onClick={() => setShowTemplates(v => !v)} title="Quick replies"
            className="text-text-muted hover:text-accent transition-colors text-xs font-mono">/</button>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder={canSend ? 'Votre message...' : 'Chat disconnected'}
            disabled={!canSend}
            className="flex-1 bg-transparent text-[13px] text-text-primary placeholder-text-muted outline-none disabled:opacity-40"
          />
          <input ref={fileInputRef} type="file" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSend(f); e.target.value = ''; }} />
          <button onClick={() => fileInputRef.current?.click()} disabled={!canSend}
            className="text-text-muted hover:text-accent transition-colors disabled:opacity-30">
            <Paperclip className="w-4 h-4" />
          </button>
          <button onClick={handleSend} disabled={!canSend || !input.trim()}
            className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center hover:bg-accent-hover disabled:opacity-30 transition-colors shrink-0">
            <Send className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
