/** A tick that runs longer than this is stuck (a Discord call that never answers): the bot restarts itself. */
export const STUCK_MS = 10 * 60_000;

/**
 * `busy` stays true while a tick runs. A call that never returns would keep it true for ever and the bot would look
 * alive and do nothing; Docker cannot tell. Exiting lets `restart: unless-stopped` start a fresh process (a message
 * that was being sent is not posted twice: it carries a nonce).
 */
export function stuckFor(now: number, startedAt: number, isBusy: boolean, limit = STUCK_MS): boolean {
  return isBusy && startedAt > 0 && now - startedAt > limit;
}
