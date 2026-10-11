declare module 'gamedig' {
  export interface QueryOptions {
    type: string;
    host: string;
    port?: number;
    maxRetries?: number;
    socketTimeout?: number;
    attemptTimeout?: number;
    givenPortOnly?: boolean;
  }
  export class GameDig {
    static query(options: QueryOptions): Promise<any>;
  }
}
