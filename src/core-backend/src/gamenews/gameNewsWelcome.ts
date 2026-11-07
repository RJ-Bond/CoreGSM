/**
 * A greeting for a player who joins a server: the administrator writes it in the panel, the game plugin gets it with
 * every poll and shows it (to that player only) when someone connects. The setting is one JSON value:
 * `gamenews_welcome` = {"enabled": true, "text": "Привет, {name}! Добро пожаловать на {server}."}
 * {server} is filled in here, {name} (the nickname of the player) by the plugin.
 */
import { getSetting, setSetting } from '../db.js';

export interface Welcome { enabled: boolean; text: string }

export function getWelcome(): Welcome {
  try {
    const v = JSON.parse(getSetting('gamenews_welcome') || '{}') as Partial<Welcome>;
    return { enabled: !!v.enabled, text: typeof v.text === 'string' ? v.text : '' };
  } catch {
    return { enabled: false, text: '' };
  }
}

export function setWelcome(w: Welcome): void {
  setSetting('gamenews_welcome', JSON.stringify(w));
}

/** what the plugin of a server gets: '' when the greeting is off */
export function welcomeFor(serverName: string): string {
  const w = getWelcome();
  if (!w.enabled || !w.text.trim()) return '';
  return w.text.replace(/\{server\}/g, serverName.replace(/[<>]/g, '').slice(0, 60));
}
