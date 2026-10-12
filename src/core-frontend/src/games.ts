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
  { id: 'vrising', label: 'V Rising', port: 27015, abbr: 'VR', color: '#a83a5a' },
  { id: 'icarus', label: 'Icarus', port: 27015, abbr: 'IC', color: '#e0692b' },
  { id: 'projectzomboid', label: 'Project Zomboid', port: 16261, abbr: 'PZ', color: '#7a8a4a' },
  { id: 'gta5f', label: 'FiveM (GTA V)', port: 30120, abbr: '5M', color: '#f26a3d' },
  { id: 'gtasam', label: 'SA-MP', port: 7777, abbr: 'SA', color: '#8a6ad9' },
  { id: 'teamspeak3', label: 'TeamSpeak 3', port: 9987, abbr: 'TS', color: '#3a7ad9' },
];

const FALLBACK = '#5a4bd1';
export const findGame = (id: string) => GAMES.find((g) => g.id === id);
export const gameLabel = (id: string) => findGame(id)?.label ?? id;
export const gameColor = (id: string) => findGame(id)?.color ?? FALLBACK;
export const gameAbbr = (id: string) => findGame(id)?.abbr ?? id.slice(0, 2).toUpperCase();

/** artwork used instead of the line pictogram (files in public/games) */
export const GAME_IMAGE: Record<string, string> = { vrising: '/games/vrising.png' };
