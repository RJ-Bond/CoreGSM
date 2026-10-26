import { gradientFor } from './colors';
// GameDig type ids (https://github.com/gamedig/node-gamedig/blob/master/GAMES_LIST.md)
export interface Game { id: string; label: string; port: number; abbr: string; color: string }

export const GAMES: Game[] = [
  { id: 'minecraft', label: 'Minecraft: Java', port: 25565, abbr: 'MC', color: '#62b543' },
  { id: 'mbe', label: 'Minecraft: Bedrock', port: 19132, abbr: 'MB', color: '#4fa33a' },
  { id: 'counterstrike2', label: 'Counter-Strike 2', port: 27015, abbr: 'CS', color: '#f0a020' },
  { id: 'csgo', label: 'CS:GO', port: 27015, abbr: 'GO', color: '#e8962a' },
  { id: 'counterstrike16', label: 'Counter-Strike 1.6', port: 27015, abbr: '1.6', color: '#d9a441' },
  { id: 'css', label: 'Counter-Strike: Source', port: 27015, abbr: 'CS', color: '#d98f3a' },
  { id: 'rust', label: 'Rust', port: 28015, abbr: 'RS', color: '#e0502d' },
  { id: 'valheim', label: 'Valheim', port: 2456, abbr: 'VH', color: '#4d8fc7' },
  { id: 'garrysmod', label: "Garry's Mod", port: 27015, abbr: 'GM', color: '#3a8fd9' },
  { id: 'teamfortress2', label: 'Team Fortress 2', port: 27015, abbr: 'TF', color: '#c9533a' },
  { id: 'l4d2', label: 'Left 4 Dead 2', port: 27015, abbr: 'L4', color: '#b83a3a' },
  { id: 'terraria', label: 'Terraria', port: 7777, abbr: 'TR', color: '#46b86a' },
  { id: 'sdtd', label: '7 Days to Die', port: 26900, abbr: '7D', color: '#b5483a' },
  { id: 'dayz', label: 'DayZ', port: 2302, abbr: 'DZ', color: '#6f8f4a' },
  { id: 'ase', label: 'ARK: Survival Evolved', port: 27015, abbr: 'AK', color: '#3aa6a0' },
  { id: 'asa', label: 'ARK: Survival Ascended', port: 7777, abbr: 'AS', color: '#2f9ea8' },
  { id: 'conanexiles', label: 'Conan Exiles', port: 7777, abbr: 'CE', color: '#a8743a' },
  { id: 'palworld', label: 'Palworld', port: 8211, abbr: 'PW', color: '#2fc4bf' },
  { id: 'factorio', label: 'Factorio', port: 34197, abbr: 'FC', color: '#d98a3a' },
  { id: 'unturned', label: 'Unturned', port: 27015, abbr: 'UT', color: '#4aa86a' },
  { id: 'vrising', label: 'V Rising', port: 27015, abbr: 'VR', color: '#7c3aed' },
  { id: 'icarus', label: 'Icarus', port: 27015, abbr: 'IC', color: '#f5b01e' },
  { id: 'm2o', label: 'Mafia II: Online', port: 27015, abbr: 'M2', color: '#c9a24a' },
  { id: 'projectzomboid', label: 'Project Zomboid', port: 16261, abbr: 'PZ', color: '#7a8a4a' },
  { id: 'gta5f', label: 'FiveM (GTA V)', port: 30120, abbr: '5M', color: '#f26a3d' },
  { id: 'gtasam', label: 'SA-MP', port: 7777, abbr: 'SA', color: '#8a6ad9' },
  { id: 'teamspeak3', label: 'TeamSpeak 3', port: 9987, abbr: 'TS', color: '#3a7ad9' },
];

/** a game the panel has no colour for gets one made from its name (the same name, the same colour; the backend does the same) */
export function monogramColor(name: string): string {
  let h = 7;
  for (const c of name.toLowerCase()) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const a = 0.55 * Math.min(0.5, 0.5);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const c = 0.5 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
/** one or two letters: the capitals of the first two words, else the first two letters */
export function monogramOf(label: string): string {
  const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

export const findGame = (id: string) => GAMES.find((g) => g.id === id);
export const gameLabel = (id: string) => findGame(id)?.label ?? id;
export const gameColor = (id: string) => findGame(id)?.color ?? monogramColor(id);
export const gameAbbr = (id: string) => findGame(id)?.abbr ?? monogramOf(id);

/** artwork used instead of the line pictogram (files in public/games) */
/** games with their own artwork: PNG logos, and the emblems drawn by tools/gen-game-emblems.cjs (public/games/<id>.svg) */
export const EMBLEM_GAMES = [
  'minecraft', 'mbe', 'counterstrike2', 'csgo', 'counterstrike16', 'css', 'rust', 'valheim', 'garrysmod', 'teamfortress2', 'l4d2', 'terraria',
  'sdtd', 'dayz', 'ase', 'asa', 'conanexiles', 'palworld', 'factorio', 'unturned', 'projectzomboid', 'gta5f', 'gtasam', 'teamspeak3',
] as const;
export const GAME_IMAGE: Record<string, string> = {
  vrising: '/games/vrising.png',
  icarus: '/games/icarus.png',
  m2o: '/games/m2o.png',
  ...Object.fromEntries(EMBLEM_GAMES.map((id) => [id, `/games/${id}.svg`])),
};

/** [deep, light] gradient colours of a game (tile covers, banners) */
export const gameGradient = (id: string): [string, string] => gradientFor(gameColor(id));
