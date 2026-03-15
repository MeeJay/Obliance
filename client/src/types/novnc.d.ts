// Minimal type declarations for @novnc/novnc/core/rfb.js
// The package ships .d.ts but Vite may need this fallback for some setups.
declare module '@novnc/novnc/core/rfb.js' {
  interface RFBOptions {
    /** true = view-only (no input events sent to server) */
    viewOnly?: boolean;
    /** true = scale viewport to fit the container */
    scaleViewport?: boolean;
    /** true = show a dot cursor when the remote cursor is outside */
    showDotCursor?: boolean;
    /** Credentials passed on the 'credentialsrequired' event */
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
