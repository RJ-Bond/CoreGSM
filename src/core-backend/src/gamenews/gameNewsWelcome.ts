/**
 * A greeting for a player who joins a server: the administrator writes it in the panel, the game plugin gets it with
 * every poll and shows it (to that player only) when someone connects. The setting is one JSON value:
 * `gamenews_welcome` = {"enabled": true, "text": "...", "split": true, "newText": "..."}
 *   text     for a player who has been here before (and for everybody when `split` is off)
 *   newText  for a player who joins for the first time (used when `split` is on)
 * The panel fills in the variables ({server}, {online}, {greeting}, {restart} ...) for the server that asks; {name}, the
 * nickname of the player, is filled in by the plugin, which also knows whether the player has been here before.
 */
import { readScoped, writeScoped } from './gameNewsScope.js';
import { applyVars, greenName } from './gameNewsLogic.js';
import { varsFor } from './gameNewsVars.js';

export interface Welcome { enabled: boolean; text: string; split: boolean; newText: string }

export function getWelcome(serverId?: number): Welcome {
  try {
    const v = JSON.parse(readScoped('gamenews_welcome', serverId) || '{}') as Partial<Welcome>;
    return {
      enabled: !!v.enabled,
      text: typeof v.text === 'string' ? v.text : '',
      split: !!v.split,
      newText: typeof v.newText === 'string' ? v.newText : '',
    };
  } catch {
    return { enabled: false, text: '', split: false, newText: '' };
  }
}

export function setWelcome(w: Welcome, serverId?: number): void {
  writeScoped('gamenews_welcome', JSON.stringify(w), serverId);
}

/** what the plugin of a server gets: '' when the greeting is off */
export function welcomeFor(serverId: number, now: number): { welcome: string; welcomeNew: string } {
  const w = getWelcome(serverId);
  if (!w.enabled || !w.text.trim()) return { welcome: '', welcomeNew: '' };
  const vars = varsFor(serverId, now);
  // the player's name is green unless the administrator coloured it
  const fill = (t: string) => applyVars(greenName(t), vars);
  const welcome = fill(w.text);
  return { welcome, welcomeNew: w.split && w.newText.trim() ? fill(w.newText) : welcome };
}
