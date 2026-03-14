declare module 'gamedig' {
  interface QueryOptions {
    type: string;
    host: string;
    port?: number;
    maxRetries?: number;
    socketTimeout?: number;
    attemptTimeout?: number;
    givenPortOnly?: boolean;
  }

  interface QueryResult {
    name: string;
    map: string;
    password: boolean;
    numplayers: number;
    maxplayers: number;
    players: Array<{ name?: string; raw?: unknown }>;
    bots: Array<{ name?: string; raw?: unknown }>;
    connect: string;
    ping: number;
    raw?: unknown;
  }

  export class GameDig {
    static query(options: QueryOptions): Promise<QueryResult>;
  }
}
