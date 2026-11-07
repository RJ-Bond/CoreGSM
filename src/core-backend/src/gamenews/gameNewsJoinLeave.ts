/**
 * «* Игрок {name} подключился к серверу.» for everybody in the game chat when a player joins or leaves.
 * The administrator sets, per message, whether it is shown, its text and the two colours: the one of the player's name
 * and the one of the rest of the text. One JSON setting: `gamenews_joinleave`. The panel builds the tagged text and
 * the plugin only puts the nickname into {name}.
 */
import { getSetting, setSetting } from '../db.js';

export interface JoinLeave {
  joinEnabled: boolean;
  leaveEnabled: boolean;
  joinText: string;
  leaveText: string;
  nameColor: string;
  textColor: string;
}

export const DEFAULT_JOIN_LEAVE: JoinLeave = {
  joinEnabled: false,
  leaveEnabled: false,
  joinText: '* Игрок {name} подключился к серверу.',
  leaveText: '* Игрок {name} отключился от сервера.',
  nameColor: '#B86BFF', // purple
  textColor: '#5FD068', // green
};

export const isHexColor = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

/** plain text for the line: no tags, no control characters, one line */
export function plainLine(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[<>]/g, '').replace(/ {2,}/g, ' ').trim();
}

export function getJoinLeave(): JoinLeave {
  try {
    const v = JSON.parse(getSetting('gamenews_joinleave') || '{}') as Partial<JoinLeave>;
    const d = DEFAULT_JOIN_LEAVE;
    return {
      joinEnabled: !!v.joinEnabled,
      leaveEnabled: !!v.leaveEnabled,
      joinText: typeof v.joinText === 'string' && v.joinText.trim() ? v.joinText : d.joinText,
      leaveText: typeof v.leaveText === 'string' && v.leaveText.trim() ? v.leaveText : d.leaveText,
      nameColor: isHexColor(v.nameColor) ? v.nameColor.toUpperCase() : d.nameColor,
      textColor: isHexColor(v.textColor) ? v.textColor.toUpperCase() : d.textColor,
    };
  } catch {
    return { ...DEFAULT_JOIN_LEAVE };
  }
}

export function setJoinLeave(v: JoinLeave): void {
  setSetting('gamenews_joinleave', JSON.stringify(v));
}

/** `text` with {name} in the name colour and everything else in the text colour: the tagged text the plugin shows */
export function composeLine(text: string, nameColor: string, textColor: string): string {
  const body = plainLine(text).replace(/\{name\}/g, `<color=${nameColor.toUpperCase()}>{name}</color>`);
  return `<color=${textColor.toUpperCase()}>${body}</color>`;
}

/** what the plugin gets with a poll: '' when that message is off */
export function joinLeaveFor(): { join: string; leave: string } {
  const v = getJoinLeave();
  return {
    join: v.joinEnabled ? composeLine(v.joinText, v.nameColor, v.textColor) : '',
    leave: v.leaveEnabled ? composeLine(v.leaveText, v.nameColor, v.textColor) : '',
  };
}
