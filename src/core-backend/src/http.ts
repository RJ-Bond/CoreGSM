/** Small helpers for Express handlers. */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Express 4 does not catch a rejected promise of an async handler: without this wrapper the rejection becomes an
 * unhandled one. Every async route handler goes through it, so an error ends in the error middleware (a 500 answer).
 * The request type is kept (`wrap(async (req: AuthedRequest, res) => ...)`).
 */
export const wrap =
  <R extends Request = Request>(fn: (req: R, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      Promise.resolve(fn(req as R, res)).catch(next);
    } catch (e) {
      next(e);
    }
  };

/**
 * Route-level check of a path parameter (Express 5 dropped `:id(\\d+)` in paths). A value that does not match falls
 * through to the next route, which ends in the 404 handler, exactly as a non-matching path did before.
 */
export const param =
  (name: string, re: RegExp = /^\d+$/) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (re.test(String(req.params[name]))) next();
    else next('route');
  };
