// Minimal type declarations for @novnc/novnc
// noVNC does not ship its own .d.ts; this file covers what we use.

interface RFBOptions {
  viewOnly?: boolean;
  scaleViewport?: boolean;
  showDotCursor?: boolean;
  credentials?: { username?: string; password?: string; target?: string };
}

type RFBEventMap = {
  connect: CustomEvent<void>;
  disconnect: CustomEvent<{ clean: boolean }>;
  credentialsrequired: CustomEvent<{ types: string[] }>;
  securityfailure: CustomEvent<{ status: number; reason?: string }>;
  capabilities: CustomEvent<{ capabilities: Record<string, boolean> }>;
  clipboard: CustomEvent<{ text: string }>;
  bell: CustomEvent<void>;
  desktopname: CustomEvent<{ name: string }>;
};

// Declare the package-root entry point (@novnc/novnc → core/rfb.js via "main" field)
declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);
    viewOnly: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;
    disconnect(): void;
    sendCredentials(credentials: { username?: string; password?: string; target?: string }): void;
    sendCtrlAltDel(): void;
    machineReboot(): void;
    machineReset(): void;
    machineShutdown(): void;
    clipboardPasteFrom(text: string): void;
    addEventListener<K extends keyof RFBEventMap>(
      type: K,
      listener: (ev: RFBEventMap[K]) => void,
      options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener<K extends keyof RFBEventMap>(
      type: K,
      listener: (ev: RFBEventMap[K]) => void,
      options?: boolean | EventListenerOptions,
    ): void;
  }
}

// Also declare the subpath for any code that imports it directly
declare module '@novnc/novnc/core/rfb.js' {
  import RFB from '@novnc/novnc';
  export default RFB;
}
