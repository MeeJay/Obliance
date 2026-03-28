import { Monitor, Apple, Terminal, Shield } from 'lucide-react';
import type { OsType } from '@obliance/shared';

interface Props {
  osType: OsType;
  className?: string;
}

export function OsIcon({ osType, className = 'w-4 h-4' }: Props) {
  switch (osType) {
    case 'windows': return <Monitor className={className} />;
    case 'macos': return <Apple className={className} />;
    case 'linux': return <Terminal className={className} />;
    case 'freebsd': return <Shield className={className} />;
    default: return <Monitor className={className} />;
  }
}
