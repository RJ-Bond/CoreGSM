/**
 * Game profiles: what the panel and the Discord embed know about every supported game (GameDig id).
 *
 *   GameProfile {
 *     id            GameDig id ('vrising')
 *     label         display name ('V Rising')
 *     defaultPort   the usual game port; 0 when there is no single default
 *     queryPortHint short Russian text about the query port, only where it is known to differ (optional)
 *     fields        which values the game server reports meaningfully:
 *                     map (map / world name), mode (game mode), version, players (player count / names)
 *                   a field set to false is not shown (the Discord embed hides "Карта" for games without a map)
 *     connect       how a player connects; templates use {address} ("host:port"), {host} and {port}:
 *                     steam   a steam:// link that launches the game (optional)
 *                     command a console command (optional)
 *                     note    a sentence with the manual steps (optional)
 *     accent        side stripe colour of the Discord embed of an online server (optional, 0xRRGGBB)
 *   }
 *
 * GET /api/games returns the list (public). Unknown GameDig ids (custom servers) have no profile: callers
 * fall back to "show everything" and the id as the label.
 */
import type { Express } from 'express';

export interface GameProfile {
  id: string;
  label: string;
  defaultPort: number;
  queryPortHint?: string;
  fields: { map: boolean; mode: boolean; version: boolean; players: boolean };
  connect: { steam?: string; command?: string; note?: string };
  accent?: number;
}

const F = (map: boolean, mode: boolean, version: boolean, players = true) => ({ map, mode, version, players });
const STEAM = 'steam://connect/{address}';
const CONSOLE = 'connect {address}';

export const GAME_PROFILES: GameProfile[] = [
  { id: 'minecraft', label: 'Minecraft: Java', defaultPort: 25565, fields: F(false, false, true), connect: { note: 'Сетевая игра → Добавить сервер → введите адрес {address}.' } },
  { id: 'mbe', label: 'Minecraft: Bedrock', defaultPort: 19132, fields: F(false, true, true), connect: { note: 'Играть → Серверы → Добавить сервер: адрес {host}, порт {port}.' } },
  { id: 'counterstrike2', label: 'Counter-Strike 2', defaultPort: 27015, fields: F(true, true, true), connect: { steam: STEAM, command: CONSOLE } },
  { id: 'csgo', label: 'CS:GO', defaultPort: 27015, fields: F(true, true, true), connect: { steam: STEAM, command: CONSOLE } },
  { id: 'counterstrike16', label: 'Counter-Strike 1.6', defaultPort: 27015, fields: F(true, true, true), connect: { steam: STEAM, command: CONSOLE } },
  { id: 'css', label: 'Counter-Strike: Source', defaultPort: 27015, fields: F(true, true, true), connect: { steam: STEAM, command: CONSOLE } },
  {
    id: 'rust',
    label: 'Rust',
    defaultPort: 28015,
    queryPortHint: 'Rust: если сервер не отвечает, проверьте query-порт сервера (параметр server.queryport).',
    fields: F(true, false, true),
    connect: { steam: STEAM, command: 'client.connect {address}' },
  },
  {
    id: 'valheim',
    label: 'Valheim',
    defaultPort: 2456,
    queryPortHint: 'Для Valheim порт запроса = игровой порт + 1.',
    fields: F(false, false, true),
    connect: { steam: STEAM, note: 'Join Game → Join IP → введите адрес сервера: {address}.' },
  },
  { id: 'garrysmod', label: "Garry's Mod", defaultPort: 27015, fields: F(true, true, true), connect: { steam: STEAM, command: CONSOLE } },
  { id: 'teamfortress2', label: 'Team Fortress 2', defaultPort: 27015, fields: F(true, true, true), connect: { steam: STEAM, command: CONSOLE } },
  { id: 'l4d2', label: 'Left 4 Dead 2', defaultPort: 27015, fields: F(true, true, true), connect: { steam: STEAM, command: CONSOLE } },
  {
    id: 'terraria',
    label: 'Terraria',
    defaultPort: 7777,
    queryPortHint: 'Для Terraria нужен TShock с включённым REST API; порт запроса — порт REST (по умолчанию 7878).',
    fields: F(true, false, true),
    connect: { note: 'Multiplayer → Join via IP → {host}, порт {port}.' },
  },
  { id: 'sdtd', label: '7 Days to Die', defaultPort: 26900, fields: F(true, true, true), connect: { steam: STEAM, note: 'Join a Game → Server Browser или Direct Connect: {address}.' } },
  { id: 'dayz', label: 'DayZ', defaultPort: 2302, queryPortHint: 'Для DayZ порт запроса обычно 27016 (steamQueryPort).', fields: F(true, false, true), connect: { steam: STEAM, note: 'DZSALauncher или Играть → Direct Connect: {address}.' } },
  {
    id: 'ase',
    label: 'ARK: Survival Evolved',
    defaultPort: 7777,
    queryPortHint: 'Для ARK порт запроса по умолчанию 27015 (QueryPort), игровой — 7777.',
    fields: F(true, false, true),
    connect: { steam: STEAM, note: 'Join ARK → Session Filter → найдите сервер по имени или IP.' },
  },
  {
    id: 'asa',
    label: 'ARK: Survival Ascended',
    defaultPort: 7777,
    queryPortHint: 'Для ARK порт запроса по умолчанию 27015 (QueryPort), игровой — 7777.',
    fields: F(true, false, true),
    connect: { note: 'Join Game → Unofficial → найдите сервер по имени или по IP.' },
  },
  {
    id: 'conanexiles',
    label: 'Conan Exiles',
    defaultPort: 7777,
    queryPortHint: 'Для Conan Exiles порт запроса по умолчанию 27015, игровой — 7777.',
    fields: F(true, false, true),
    connect: { steam: STEAM, note: 'Online → Server Browser или Direct Connect: {host}:{port}.' },
  },
  {
    id: 'palworld',
    label: 'Palworld',
    defaultPort: 8211,
    queryPortHint: 'Для Palworld порт запроса по умолчанию 27015, игровой — 8211.',
    fields: F(false, false, true),
    connect: { note: 'Join Multiplayer Game → введите {address} в строке подключения.' },
  },
  { id: 'factorio', label: 'Factorio', defaultPort: 34197, fields: F(false, false, true), connect: { note: 'Multiplayer → Connect to address → {address}.' } },
  {
    id: 'unturned',
    label: 'Unturned',
    defaultPort: 27015,
    queryPortHint: 'Для Unturned порт запроса = игровой порт + 1.',
    fields: F(true, true, true),
    connect: { steam: STEAM, note: 'Play → Connect → введите IP и порт.' },
  },
  {
    id: 'vrising',
    label: 'V Rising',
    defaultPort: 9876,
    queryPortHint: 'Для V Rising порт запроса = игровой порт + 1.',
    fields: F(false, false, true),
    connect: { steam: STEAM, note: 'Play Online → Find Server → найдите сервер по имени.' },
    accent: 0x8b5cf6,
  },
  {
    id: 'icarus',
    label: 'Icarus',
    defaultPort: 17777,
    queryPortHint: 'Для Icarus порт запроса по умолчанию 27015, игровой — 17777.',
    fields: F(false, false, true),
    connect: { note: 'Open Missions → Dedicated Servers → найдите сервер по имени.' },
    accent: 0xf5b01e,
  },
  {
    id: 'm2o',
    label: 'Mafia II: Online',
    defaultPort: 27015,
    queryPortHint: 'Mafia II: Online: игра идёт по UDP на порту 27015, а панель спрашивает версию и слоты по TCP на порту игры + 1 (27016). Имя сервера и число игроков панель берёт из публичного мастер-листа, если сервер в нём есть (задан server-token).',
    fields: F(true, false, true),
    connect: { note: 'В клиенте Mafia II: Online выберите сервер в списке или подключитесь напрямую: {address}.' },
    accent: 0xc9a24a,
  },
  { id: 'projectzomboid', label: 'Project Zomboid', defaultPort: 16261, fields: F(true, false, true), connect: { steam: STEAM, note: 'Join → введите IP {host}, порт {port}.' } },
  { id: 'gta5f', label: 'FiveM (GTA V)', defaultPort: 30120, fields: F(false, true, true), connect: { command: 'connect {address}', note: 'В клиенте FiveM: F8 → connect {address}.' } },
  { id: 'gtasam', label: 'SA-MP', defaultPort: 7777, fields: F(true, true, true), connect: { note: 'В клиенте SA-MP: Add Server → {address}.' } },
  {
    id: 'teamspeak3',
    label: 'TeamSpeak 3',
    defaultPort: 9987,
    queryPortHint: 'Для TeamSpeak 3 порт запроса — ServerQuery, по умолчанию 10011.',
    fields: F(false, false, true),
    connect: { command: 'ts3server://{host}?port={port}', note: 'Connections → Connect → {address}.' },
  },
];

const BY_ID = new Map(GAME_PROFILES.map((p) => [p.id, p]));

/** Display names for GameDig ids (kept in sync with core-frontend/src/games.ts) */
export const GAME_LABELS: Record<string, string> = Object.fromEntries(GAME_PROFILES.map((p) => [p.id, p.label]));

/** games added with a JSON file in <data>/games (see customGames.ts); the built-in ones always win */
let CUSTOM: GameProfile[] = [];
const CUSTOM_BY_ID = new Map<string, GameProfile>();
export function setCustomGames(list: GameProfile[]): void {
  CUSTOM = list.filter((p) => !BY_ID.has(p.id));
  CUSTOM_BY_ID.clear();
  for (const p of CUSTOM) CUSTOM_BY_ID.set(p.id, p);
}
export const builtinGameIds = (): Set<string> => new Set(BY_ID.keys());

export const gameLabel = (id: string): string => GAME_LABELS[id] ?? CUSTOM_BY_ID.get(id)?.label ?? id;

export const gameProfile = (id: string): GameProfile | undefined => BY_ID.get(id) ?? CUSTOM_BY_ID.get(id);

/** Does the game report a map worth showing? Unknown games (custom GameDig ids) are shown in full. */
export const gameShowsMap = (id: string): boolean => gameProfile(id)?.fields.map ?? true;

export function registerGames(app: Express): void {
  app.get('/api/games', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json([...GAME_PROFILES, ...CUSTOM]);
  });
}
