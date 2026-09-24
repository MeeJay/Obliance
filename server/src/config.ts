import './env';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',
  databaseUrl: process.env.DATABASE_URL || 'postgres://obliance:changeme@localhost:5432/obliance',
  sessionSecret: process.env.SESSION_SECRET || 'change-this-secret',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  forceHttps: process.env.FORCE_HTTPS === 'true',
  appName: process.env.APP_NAME || 'Obliance',
  appUrl: process.env.APP_URL || '',
  // Default admin credentials — only consulted on a fresh DB. The
  // password defaults to the canonical "admin123" so dev installs Just
  // Work, but `ensureDefaultAdmin` refuses to bootstrap if the password
  // is still the default OR shorter than 12 characters (see
  // index.ts:ensureDefaultAdmin). Production installs MUST set
  // DEFAULT_ADMIN_PASSWORD via env.
  defaultAdminUsername: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
  defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
  disable2faForce: process.env.DISABLE_2FA_FORCE === 'true',
  minPushInterval: parseInt(process.env.MIN_PUSH_INTERVAL || '10', 10),
  customDir: process.env.CUSTOM_DIR || './custom',
  // Remote access
  remoteTunnelPath: '/api/remote/tunnel',
  // SSH Bastion (ObliJump) — opt-in via .env, like the Oblihub stacks. The
  // ssh2 server only binds when enabled; SSH_BASTION_PORT must NOT be 22 (that
  // stays the host sshd). This port is the one guarded by the IP whitelist,
  // anti-bruteforce and honeypot.
  sshBastion: {
    enabled: process.env.SSH_BASTION_ENABLED === 'true',
    port: parseInt(process.env.SSH_BASTION_PORT || '2222', 10),
  },
};
