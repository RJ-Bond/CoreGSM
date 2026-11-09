/**
 * Where a message of the panel goes. Messages about the server game state (down, back, a place freed) go to the alerts
 * channel. The service messages (the plugin of a game is silent or back, the disk is filling, the panel was updated)
 * go to the service channel when the administrator has chosen one, so all the problems with the panel are in one place.
 */
export const SYSTEM_KINDS: ReadonlySet<string> = new Set(['update', 'disk']);

export interface RouteSettings { enabled: boolean; channelId: string; systemChannelId: string }

/** the channel of one message: the one it was sent to explicitly, else the service channel for a service kind, else the alerts channel */
export function alertTarget(kind: string, explicit: string | undefined, s: RouteSettings): string {
  if (explicit) return explicit;
  if (SYSTEM_KINDS.has(kind) && s.systemChannelId) return s.systemChannelId;
  return s.channelId;
}

/** where a service message can go now: the service channel (whether or not the alerts are on), else the alerts channel when they are on; '' = nowhere */
export function systemTarget(s: RouteSettings): string {
  return s.systemChannelId || (s.enabled ? s.channelId : '');
}
