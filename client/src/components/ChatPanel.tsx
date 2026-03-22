import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Shield, MessageCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { getSocket } from '@/socket/socketClient';

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
  /** External messages array — allows sharing state between ChatPanel instances */
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  chatId: string | null;
  setChatId: React.Dispatch<React.SetStateAction<string | null>>;
}

// Notification sound (short "ding" via Web Audio API)
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
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [remoteRequested, setRemoteRequested] = useState(false);
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Open chat session on mount
  useEffect(() => {
    const socket = getSocket();
    if (!socket || chatId) return; // already connected

    // Request chat session
    socket.emit('chat:open', { deviceUuid, sessionId, operatorName }, (res: { chatId?: string; error?: string }) => {
      if (res?.chatId) {
        setChatId(res.chatId);
        setIsConnected(true);
        socket.join?.(`chat:${res.chatId}`);
        // Also join via emit for Socket.io v4
        socket.emit('join', `chat:${res.chatId}`);
      } else {
        setMessages(prev => [...prev, {
          sender: 'System',
          text: `Failed to open chat: ${res?.error || 'agent offline or not connected'}`,
          timestamp: Date.now(),
          isSystem: true,
        }]);
      }
    });

    // If the ack doesn't fire within 5s, show an error
    const timeout = setTimeout(() => {
      if (!chatId) {
        setMessages(prev => {
          if (prev.some(m => m.text.includes('Failed to open'))) return prev;
          return [...prev, {
            sender: 'System',
            text: 'Chat connection timed out. The Oblireach agent may be offline.',
            timestamp: Date.now(),
            isSystem: true,
          }];
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
      playNotificationSound();
    };

    const onClosed = (data: { chatId: string }) => {
      if (data.chatId !== chatId) return;
      setMessages(prev => [...prev, {
        sender: 'System',
        text: 'The user has closed the chat.',
        timestamp: Date.now(),
        isSystem: true,
      }]);
      setIsConnected(false);
    };

    const onRemoteResponse = (data: { chatId: string; allowed: boolean }) => {
      if (data.chatId !== chatId) return;
      setRemoteRequested(false);
      if (data.allowed) {
        setMessages(prev => [...prev, {
          sender: 'System',
          text: 'Remote control access granted by the user.',
          timestamp: Date.now(),
          isSystem: true,
        }]);
        onRemoteAccessGranted?.();
      } else {
        setMessages(prev => [...prev, {
          sender: 'System',
          text: 'Remote control access denied by the user.',
          timestamp: Date.now(),
          isSystem: true,
        }]);
      }
    };

    socket.on('chat:message', onMessage);
    socket.on('chat:closed', onClosed);
    socket.on('chat:remote_response', onRemoteResponse);

    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:closed', onClosed);
      socket.off('chat:remote_response', onRemoteResponse);
    };
  }, [chatId, setChatId, setMessages, onRemoteAccessGranted]);

  const handleSend = useCallback(() => {
    if (!input.trim() || !chatId) return;
    const socket = getSocket();
    if (!socket) return;

    const msg: ChatMessage = {
      sender: operatorName,
      text: input.trim(),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, msg]);
    socket.emit('chat:message', { chatId, message: input.trim(), operatorName });
    setInput('');
    inputRef.current?.focus();
  }, [input, chatId, operatorName, setMessages]);

  const handleClose = useCallback(() => {
    const socket = getSocket();
    if (socket && chatId) {
      socket.emit('chat:close', { chatId });
    }
    onClose();
  }, [chatId, onClose]);

  const handleRequestRemote = useCallback(() => {
    const socket = getSocket();
    if (!socket || !chatId) return;
    socket.emit('chat:request_remote', { chatId, message: requestMessage });
    setRemoteRequested(true);
    setShowRequestDialog(false);
    setMessages(prev => [...prev, {
      sender: 'System',
      text: 'Remote control request sent to the user.',
      timestamp: Date.now(),
      isSystem: true,
    }]);
  }, [chatId, requestMessage, setMessages]);

  return (
    <div className="flex flex-col h-full bg-bg-primary border-l border-border" style={{ width: 360 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-secondary shrink-0">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-text-primary">Chat</span>
          {isConnected && <span className="w-2 h-2 rounded-full bg-green-400" />}
        </div>
        <button onClick={handleClose} className="p-1 text-text-muted hover:text-red-400 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((msg, i) => (
          <div key={i} className={clsx('flex flex-col', msg.isSystem ? 'items-center' : msg.sender === operatorName ? 'items-end' : 'items-start')}>
            {msg.isSystem ? (
              <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded">{msg.text}</span>
            ) : (
              <>
                <span className="text-[10px] text-text-muted mb-0.5">{msg.sender}</span>
                <div className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm max-w-[85%]',
                  msg.sender === operatorName
                    ? 'bg-accent/20 text-text-primary'
                    : 'bg-bg-tertiary text-text-primary'
                )}>
                  {msg.text}
                </div>
              </>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Request Remote Control dialog */}
      {showRequestDialog && (
        <div className="px-3 py-2 border-t border-border bg-blue-500/10 space-y-2">
          <p className="text-xs text-text-muted">Custom message (optional):</p>
          <input
            value={requestMessage}
            onChange={e => setRequestMessage(e.target.value)}
            placeholder="e.g., I need to check your settings..."
            className="w-full px-2 py-1.5 text-xs bg-bg-tertiary border border-border rounded text-text-primary"
          />
          <div className="flex gap-2">
            <button onClick={handleRequestRemote}
              className="flex-1 px-2 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/80 transition-colors">
              Send Request
            </button>
            <button onClick={() => setShowRequestDialog(false)}
              className="px-2 py-1.5 text-xs bg-bg-tertiary text-text-muted rounded hover:text-text-primary transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="shrink-0 border-t border-border p-2 space-y-2">
        {/* Request Remote Control button */}
        {isConnected && !remoteRequested && !showRequestDialog && (
          <button
            onClick={() => setShowRequestDialog(true)}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded hover:bg-blue-500/20 transition-colors"
          >
            <Shield className="w-3.5 h-3.5" />
            Request Remote Control
          </button>
        )}
        {remoteRequested && (
          <div className="text-xs text-center text-yellow-400 py-1">Waiting for user response...</div>
        )}

        {/* Input */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder={isConnected ? 'Type a message...' : 'Chat disconnected'}
            disabled={!isConnected}
            className="flex-1 px-3 py-1.5 text-sm bg-bg-tertiary border border-border rounded text-text-primary disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!isConnected || !input.trim()}
            className="px-3 py-1.5 bg-accent text-white rounded hover:bg-accent/80 disabled:opacity-40 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
