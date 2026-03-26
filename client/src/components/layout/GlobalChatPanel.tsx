import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Send, Shield, Paperclip, Minus, Volume2, VolumeX, MessageCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { getSocket } from '@/socket/socketClient';
import { useAuthStore } from '@/store/authStore';
import { useChatStore, type ChatSession } from '@/store/chatStore';

// ── Audio ──────────────────────────────────────────────────────────────────────
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

// ── Operator avatar ────────────────────────────────────────────────────────────
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

// ── Single tab content ─────────────────────────────────────────────────────────
function ChatTabContent({ session }: { session: ChatSession }) {
  const [input, setInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [remoteRequested, setRemoteRequested] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const store = useChatStore;
  const soundEnabled = useChatStore(s => s.soundEnabled);
  const operatorAvatar = useAuthStore.getState().user?.avatar || null;
  const operatorName = useAuthStore.getState().user?.displayName || useAuthStore.getState().user?.username || 'Operator';

  const { key, deviceUuid, chatId, messages, isConnected, userClosed, sessionId } = session;

  // Scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Open chat session on mount
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  useEffect(() => {
    const socket = getSocket();
    if (!socket || chatId) return;
    socket.emit('chat:open', { deviceUuid, sessionId, operatorName }, (res: { chatId?: string; error?: string }) => {
      if (res?.chatId) {
        store.getState().setChatId(key, res.chatId);
        store.getState().setConnected(key, true);
        socket.emit('join', `chat:${res.chatId}`);
      } else {
        store.getState().addMessage(key, {
          sender: 'System', text: `Failed to open chat: ${res?.error || 'agent offline'}`,
          timestamp: Date.now(), isSystem: true,
        });
      }
    });
    const timeout = setTimeout(() => {
      if (!chatIdRef.current) {
        store.getState().addMessage(key, {
          sender: 'System', text: 'Chat connection timed out.',
          timestamp: Date.now(), isSystem: true,
        });
      }
    }, 5000);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Socket listeners
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !chatId) return;
    socket.emit('join', `chat:${chatId}`);

    const onMessage = (data: { chatId: string; sender: string; message: string; timestamp: number }) => {
      if (data.chatId !== chatId) return;
      store.getState().addMessage(key, { sender: data.sender, text: data.message, timestamp: data.timestamp });
      if (soundEnabled) playNotificationSound();
      if (store.getState().sessions.find(s => s.key === key)?.userClosed) {
        store.getState().setUserClosed(key, false);
      }
    };
    const onClosed = (data: { chatId: string }) => {
      if (data.chatId !== chatId) return;
      store.getState().addMessage(key, {
        sender: 'System',
        text: 'The user has closed the chat. You can still send messages — the chat will reopen on their screen.',
        timestamp: Date.now(), isSystem: true,
      });
      store.getState().setUserClosed(key, true);
    };
    const onRemoteResponse = (data: { chatId: string; allowed: boolean }) => {
      if (data.chatId !== chatId) return;
      setRemoteRequested(false);
      store.getState().addMessage(key, {
        sender: 'System',
        text: data.allowed ? 'Remote control access granted.' : 'Remote control access denied.',
        timestamp: Date.now(), isSystem: true,
      });
    };

    socket.on('chat:message', onMessage);
    socket.on('chat:closed', onClosed);
    socket.on('chat:remote_response', onRemoteResponse);
    return () => { socket.off('chat:message', onMessage); socket.off('chat:closed', onClosed); socket.off('chat:remote_response', onRemoteResponse); };
  }, [chatId, key, soundEnabled]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !chatId) return;
    const socket = getSocket();
    if (!socket) return;
    store.getState().addMessage(key, { sender: operatorName, text: input.trim(), timestamp: Date.now() });
    socket.emit('chat:message', { chatId, message: input.trim(), operatorName });
    setInput('');
    inputRef.current?.focus();
  }, [input, chatId, key, operatorName]);

  const handleFileSend = useCallback(async (file: File) => {
    if (!chatId || (!isConnected && !userClosed)) return;
    if (file.size > 5 * 1024 * 1024) {
      store.getState().addMessage(key, { sender: 'System', text: 'File too large (max 5 MB)', timestamp: Date.now(), isSystem: true });
      return;
    }
    setUploadProgress(`Sending ${file.name}...`);
    try {
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      const socket = getSocket();
      if (socket) {
        socket.emit('chat:file', { chatId, fileName: file.name, fileSize: file.size, fileData: b64 });
        store.getState().addMessage(key, { sender: operatorName, text: `📎 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, timestamp: Date.now() });
      }
    } catch {
      store.getState().addMessage(key, { sender: 'System', text: 'Failed to send file', timestamp: Date.now(), isSystem: true });
    } finally { setUploadProgress(null); }
  }, [chatId, isConnected, userClosed, key, operatorName]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSend(file);
  }, [handleFileSend]);

  const handleRequestRemote = useCallback(() => {
    const socket = getSocket();
    if (!socket || !chatId) return;
    socket.emit('chat:request_remote', { chatId, message: requestMessage });
    setRemoteRequested(true);
    setShowRequestDialog(false);
    store.getState().addMessage(key, { sender: 'System', text: 'Remote control request sent.', timestamp: Date.now(), isSystem: true });
  }, [chatId, requestMessage, key]);

  const canSend = isConnected || userClosed;

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden"
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-10 bg-accent/20 border-2 border-dashed border-accent flex items-center justify-center rounded-2xl">
          <span className="text-accent font-medium">Drop file to send</span>
        </div>
      )}

      {/* Messages */}
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
        <div ref={bottomRef} />
      </div>

      {/* Request remote dialog */}
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

      {/* Bottom bar */}
      <div className="shrink-0 px-4 py-3 space-y-2 border-t border-border">
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
        {userClosed && (
          <div className="text-[10px] text-center text-yellow-400/60 py-0.5">
            User disconnected — your message will reopen the chat on their screen
          </div>
        )}

        {/* Input */}
        <div className="flex items-center gap-2 bg-bg-primary border border-border rounded-2xl px-3 py-1.5">
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

// ── Main component ─────────────────────────────────────────────────────────────
export function GlobalChatPanel() {
  const { sessions, activeKey, isOpen, isMinimized, soundEnabled } = useChatStore();
  const { setActiveTab, closeTab, setMinimized, toggleOpen, toggleSound, clearUnread } = useChatStore();

  const activeSession = sessions.find(s => s.key === activeKey) ?? null;
  const totalUnread = sessions.reduce((sum, s) => sum + s.unread, 0);

  // Clear unread when tab becomes active
  useEffect(() => {
    if (activeKey && isOpen && !isMinimized) {
      clearUnread(activeKey);
    }
  }, [activeKey, isOpen, isMinimized, clearUnread]);

  // Nothing to show
  if (sessions.length === 0) return null;

  // Minimized FAB
  if (isMinimized || !isOpen) {
    return (
      <button
        onClick={() => { if (isMinimized) setMinimized(false); else toggleOpen(); }}
        className="fixed bottom-6 right-6 z-[60] w-14 h-14 rounded-full bg-accent shadow-lg shadow-accent/30 flex items-center justify-center hover:scale-105 transition-transform"
      >
        <MessageCircle className="w-6 h-6 text-white" />
        {totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className="fixed right-4 bottom-4 z-[60] flex flex-col bg-bg-secondary border border-border rounded-2xl shadow-2xl overflow-hidden"
      style={{ width: 400, maxHeight: 'calc(100vh - 100px)', height: 620 }}
    >
      {/* Tab bar + controls */}
      <div className="flex items-center border-b border-border shrink-0">
        {/* Tabs */}
        <div className="flex-1 flex items-center overflow-x-auto gap-0 min-w-0">
          {sessions.map(s => (
            <button
              key={s.key}
              onClick={() => { setActiveTab(s.key); clearUnread(s.key); }}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors shrink-0 max-w-[160px]',
                s.key === activeKey
                  ? 'border-accent text-text-primary bg-bg-tertiary/50'
                  : 'border-transparent text-text-muted hover:text-text-primary hover:bg-bg-hover',
              )}
            >
              {/* Connection dot */}
              <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0',
                s.isConnected && !s.userClosed ? 'bg-green-400' : s.userClosed ? 'bg-yellow-400' : 'bg-gray-500'
              )} />
              <span className="truncate">{s.deviceName}</span>
              {s.unread > 0 && (
                <span className="w-4 h-4 bg-accent text-white text-[9px] font-bold rounded-full flex items-center justify-center shrink-0">
                  {s.unread > 9 ? '9+' : s.unread}
                </span>
              )}
              {/* Close tab */}
              <span
                onClick={e => { e.stopPropagation(); const socket = getSocket(); if (socket && s.chatId) socket.emit('chat:close', { chatId: s.chatId }); closeTab(s.key); }}
                className="ml-0.5 p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
              >
                <X className="w-3 h-3" />
              </span>
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 px-2 shrink-0">
          <button onClick={toggleSound} className="p-1.5 text-text-muted hover:text-text-primary transition-colors" title={soundEnabled ? 'Mute' : 'Unmute'}>
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => setMinimized(true)} className="p-1.5 text-text-muted hover:text-text-primary transition-colors">
            <Minus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Active tab content */}
      {activeSession ? (
        <ChatTabContent key={activeSession.key} session={activeSession} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          No active chat
        </div>
      )}
    </div>
  );
}
