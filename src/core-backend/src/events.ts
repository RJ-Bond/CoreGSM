/**
 * The bus of events inside the backend: something happened, whoever is interested hears it. Nobody has to know who
 * else listens, so the live updates (live.ts), and later the alerts and the webhooks, hang on one place instead of on
 * timers and direct calls. A listener that throws is logged and never stops the others or the thing that happened.
 */
import { EventEmitter } from 'node:events';
import { log } from './logger.js';

export interface BusEvents {
  /** a server has been polled (the state may be the same as before) */
  'server.polled': { id: number; online: boolean; players: number };
  /** a server went online or offline (not for the first poll of a new server) */
  'server.state': { id: number; online: boolean; previous: boolean; at: number };
  /** a setting of the panel was changed (the key, not the value) */
  'settings.changed': { key: string; actor: string | null };
}
export type BusName = keyof BusEvents;

class Bus {
  private readonly em = new EventEmitter();
  constructor() {
    this.em.setMaxListeners(50);
  }

  on<K extends BusName>(name: K, fn: (e: BusEvents[K]) => void): () => void {
    this.em.on(name, fn as (...a: unknown[]) => void);
    return () => this.em.off(name, fn as (...a: unknown[]) => void);
  }

  emit<K extends BusName>(name: K, e: BusEvents[K]): void {
    for (const fn of this.em.listeners(name) as ((e: BusEvents[K]) => void)[]) {
      try {
        fn(e);
      } catch (err) {
        log.error(`listener of «${name}» failed`, (err as Error).message);
      }
    }
  }

  listenerCount(name: BusName): number {
    return this.em.listenerCount(name);
  }
}

export const bus = new Bus();
