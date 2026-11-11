/**
 * Who is acting in this request: set by the guards once the person is known, read where a change is recorded
 * (the history of the settings) without passing the name through every function.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

const als = new AsyncLocalStorage<{ actor: string | null }>();

/** one holder per request; the guards fill it in */
export const actorMiddleware = (_req: Request, _res: Response, next: NextFunction): void => {
  als.run({ actor: null }, next);
};

export const setActor = (name: string | null): void => {
  const s = als.getStore();
  if (s) s.actor = name;
};

export const currentActor = (): string | null => als.getStore()?.actor ?? null;
