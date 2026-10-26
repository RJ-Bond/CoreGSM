/** A game described in a JSON file (no code changes): validation and the template. Pure, covered by tests. */
export interface CustomGame {
  id: string;
  label: string;
  defaultPort: number;
  queryPortHint?: string;
  fields: { map: boolean; mode: boolean; version: boolean; players: boolean };
  connect: { steam?: string; command?: string; note?: string };
  accent?: number;
}

export const GAME_TEMPLATE = {
  id: 'mygame',
  label: 'My Game',
  defaultPort: 27015,
  queryPortHint: 'Порт запроса по умолчанию совпадает с игровым.',
  fields: { map: true, mode: false, version: true, players: true },
  connect: { steam: 'steam://connect/{address}', command: 'connect {address}', note: 'В игре: Multiplayer → Direct Connect → {address}.' },
  accent: '#5a4bd1',
};

const KEYS = new Set(['id', 'label', 'defaultPort', 'queryPortHint', 'fields', 'connect', 'accent']);
const FIELD_KEYS = ['map', 'mode', 'version', 'players'] as const;
const CONNECT_KEYS = ['steam', 'command', 'note'] as const;
/** GameDig ids are lower-case words with digits, «_» and «-» */
export const GAME_ID = /^[a-z0-9][a-z0-9_-]{1,39}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseGameFile(raw: unknown): { ok: true; profile: CustomGame } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['Файл должен содержать JSON-объект'] };
  for (const k of Object.keys(raw)) if (!KEYS.has(k)) errors.push(`Неизвестное поле «${k}» (допустимы: ${[...KEYS].join(', ')})`);

  const id = raw.id;
  if (typeof id !== 'string' || !GAME_ID.test(id)) errors.push('id: строчные латинские буквы, цифры, «_» и «-», 2–40 символов — это тип игры в GameDig');
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (label.length < 1 || label.length > 60) errors.push('label: название игры, 1–60 символов');
  const port = raw.defaultPort ?? 0;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) errors.push('defaultPort: целое число 0–65535 (0 — нет порта по умолчанию)');

  let hint: string | undefined;
  if (raw.queryPortHint !== undefined) {
    if (typeof raw.queryPortHint !== 'string' || raw.queryPortHint.length > 300) errors.push('queryPortHint: текст до 300 символов');
    else hint = raw.queryPortHint.trim() || undefined;
  }

  const fields = { map: true, mode: false, version: true, players: true };
  if (raw.fields !== undefined) {
    if (!isObj(raw.fields)) errors.push('fields: объект вида {"map": true, "mode": false, "version": true, "players": true}');
    else {
      for (const k of Object.keys(raw.fields)) if (!(FIELD_KEYS as readonly string[]).includes(k)) errors.push(`fields.${k}: неизвестное поле (map, mode, version, players)`);
      for (const k of FIELD_KEYS) {
        const v = raw.fields[k];
        if (v === undefined) continue;
        if (typeof v !== 'boolean') errors.push(`fields.${k}: true или false`);
        else fields[k] = v;
      }
    }
  }

  const connect: CustomGame['connect'] = {};
  if (raw.connect !== undefined) {
    if (!isObj(raw.connect)) errors.push('connect: объект с полями steam, command, note');
    else {
      for (const k of Object.keys(raw.connect)) if (!(CONNECT_KEYS as readonly string[]).includes(k)) errors.push(`connect.${k}: неизвестное поле (steam, command, note)`);
      for (const k of CONNECT_KEYS) {
        const v = raw.connect[k];
        if (v === undefined) continue;
        if (typeof v !== 'string' || v.length > 200) errors.push(`connect.${k}: текст до 200 символов`);
        else if (k === 'steam' && !/^steam:\/\//.test(v)) errors.push('connect.steam: ссылка должна начинаться с steam://');
        else if (v.trim()) connect[k] = v.trim();
      }
    }
  }

  let accent: number | undefined;
  if (raw.accent !== undefined) {
    if (typeof raw.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.accent)) accent = parseInt(raw.accent.slice(1), 16);
    else if (typeof raw.accent === 'number' && Number.isInteger(raw.accent) && raw.accent >= 0 && raw.accent <= 0xffffff) accent = raw.accent;
    else errors.push('accent: цвет вида "#5a4bd1"');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, profile: { id: id as string, label, defaultPort: port as number, ...(hint ? { queryPortHint: hint } : {}), fields, connect, ...(accent !== undefined ? { accent } : {}) } };
}
