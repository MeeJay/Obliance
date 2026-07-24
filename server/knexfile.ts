import './src/env';
import path from 'path';
import type { Knex } from 'knex';

const isCompiled = __filename.endsWith('.js');

const config: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL || 'postgres://obliance:changeme@localhost:5432/obliance',
  searchPath: ['public'],
  migrations: {
    directory: isCompiled
      ? path.join(__dirname, 'src/db/migrations')
      : './src/db/migrations',
    extension: isCompiled ? 'js' : 'ts',
    loadExtensions: isCompiled ? ['.js'] : ['.ts'],
    schemaName: 'public',
  },
  seeds: {
    directory: isCompiled
      ? path.join(__dirname, 'src/db/seeds')
      : './src/db/seeds',
    extension: isCompiled ? 'js' : 'ts',
    loadExtensions: isCompiled ? ['.js'] : ['.ts'],
  },
  pool: {
    // An RMM ingests a push from every device on a short interval; each push
    // runs several sequential queries (status resolve, threshold resolve,
    // metric-history writes, trigger dispatch). max:10 was a hard throttle —
    // under a real fleet the pool stayed saturated and every request (UI
    // included) queued behind push traffic, which read as "the whole app is
    // slow". 60 gives real headroom at 2000+ devices once the per-push query
    // fan-out is cut (auth/config caching, metric-history batching).
    // NOTE: keep pool.max × server-replicas comfortably under the Postgres
    // max_connections — docker-compose sets it to 200; the session store keeps
    // its own small pool, so 60 leaves ample margin.
    min: 4,
    max: 60,
  },
  // Fail fast instead of hanging a request forever when the pool is starved,
  // so a transient spike surfaces as a logged error rather than a silent stall
  // on an unrelated UI call. (Knex top-level option; default is 60s.)
  acquireConnectionTimeout: 20_000,
};

export default config;
