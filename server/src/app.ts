import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Read server version from package.json at startup.
// process.cwd() is the server directory in both dev (npx tsx) and Docker (WORKDIR /app/server).
let serverVersion = 'dev';
try {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as { version: string };
  serverVersion = pkg.version;
} catch { /* ignore */ }
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';
import { routes } from './routes';
import { logger } from './utils/logger';

const PgSession = connectPgSimple(session);

export function createApp() {
  const app = express();

  // Trust the first reverse proxy hop so req.ip uses X-Forwarded-For.
  // Required for accurate rate limiting when behind Nginx / Nginx Proxy Manager.
  app.set('trust proxy', 1);

  // Security headers
  app.use(helmet());
  app.use(
    cors({
      origin: config.clientOrigin,
      credentials: true,
    }),
  );

  // Parsing — cookieParser must come before session (session reads the cookie).
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Sessions — stored in PostgreSQL via connect-pg-simple.
  // MUST be set up before apiLimiter so that req.session.userId is available
  // in the limiter's skip() function (authenticated users are excluded from
  // rate limiting to avoid shared-IP false positives behind a reverse proxy).
  // Log errors so we can diagnose DB connection drops that would otherwise
  // silently cause "Invalid username or password" on the login page.
  const sessionStore = new PgSession({
    conString: config.databaseUrl,
    tableName: 'session',
    createTableIfMissing: false,
  });
  sessionStore.on('error', (err: Error) => {
    logger.error(err, 'Session store error — sessions may fail until DB connection recovers');
  });

  app.use(
    session({
      store: sessionStore,
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: config.forceHttps,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax',
      },
    }),
  );

  // Rate limiting — runs after session so authenticated users can be skipped.
  // Only unauthenticated endpoints (login page, public health, etc.) are limited.
  app.use(apiLimiter);

  // Obligate SSO callback (browser redirect, NOT under /api)
  const obligateCallback = require('./routes/obligateCallback.routes').default;
  app.use('/auth', obligateCallback);

  // API routes
  app.use('/api', routes);

  // Health check (public — also used by login page to display server version)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: serverVersion, timestamp: new Date().toISOString() });
  });

  // Obli.tools unified desktop app downloads — serves pre-built binaries from obli.tools/dist/.
  // Whitelist prevents directory traversal; graceful 404 if a file isn't built yet.
  const DESKTOP_FILES: Record<string, string> = {
    'ObliTools.exe':          'ObliTools.exe',          // Windows binary (portable)
    'ObliToolsSetup.msi':     'ObliToolsSetup.msi',     // Windows installer (Start Menu shortcut)
    'ObliTools-arm64.zip':    'ObliTools-arm64.zip',    // macOS Apple Silicon — .app zipped
    'ObliTools-amd64.zip':    'ObliTools-amd64.zip',    // macOS Intel — .app zipped
    'ObliTools-arm64.dmg':    'ObliTools-arm64.dmg',    // macOS Apple Silicon — drag-to-Applications DMG
    'ObliTools-amd64.dmg':    'ObliTools-amd64.dmg',    // macOS Intel — drag-to-Applications DMG
  };
  // process.cwd() = server/ directory (both in dev with npx tsx and in production).
  // Go one level up to reach the project root, then into obli.tools/dist.
  const desktopDistDir = path.resolve(process.cwd(), '..', 'obli.tools', 'dist');

  app.get('/downloads/:filename', (req, res) => {
    const mapped = DESKTOP_FILES[req.params.filename];
    if (!mapped) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const filePath = path.join(desktopDistDir, mapped);
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'File not yet available' });
      return;
    }
    res.download(filePath, mapped);
  });

  // Serve static client build in production
  if (!config.isDev) {
    const clientDist = path.join(__dirname, '../../client/dist');
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Error handling
  app.use(errorHandler);

  return app;
}
