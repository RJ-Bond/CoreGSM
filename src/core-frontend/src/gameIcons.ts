// Pictograms for the games (24x24 grid, drawn with a 2px round stroke). The same data is used by the PNG card
// in the backend (core-backend/src/gameIcons.ts): keep both files in sync.
export const ICON_PATHS: Record<string, string> = {
  planet: 'M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0 M3 15c4 3 16-3 18-6',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5l8-4.5 M12 12v9',
  crosshair: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0 M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 12h.01',
  axe: 'M14.5 4l5.5 5.5-3 3-5.5-5.5z M11.5 8.5L4 20 M9 13l2 2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M12 8v8',
  sword: 'M20 4l-9.5 9.5 M20 4h-5 M20 4v5 M8 12l4 4 M5 19l3-3 M4 20l1-1',
  headset: 'M4 14v-2a8 8 0 0 1 16 0v2 M4 14h3v5H5a1 1 0 0 1-1-1z M20 14h-3v5h2a1 1 0 0 0 1-1z',
  skull: 'M12 3a7 7 0 0 0-7 7c0 2.5 1.2 4.2 3 5.3V19h8v-3.7c1.8-1.1 3-2.8 3-5.3a7 7 0 0 0-7-7z M9.5 11h.01 M14.5 11h.01 M10 19v2 M14 19v2',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5',
  paw: 'M5.8 10.5a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0 -3.4 0 M10.3 7a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0 -3.4 0 M14.8 10.5a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0 -3.4 0 M12 12c-3 0-5 2.5-5 4.5 0 1.5 1.5 2 3 1.5l2-.5 2 .5c1.5.5 3 0 3-1.5 0-2-2-4.5-5-4.5z',
  car: 'M5 17v-5l2-5h10l2 5v5 M3 17h18 M7.5 20h.01 M16.5 20h.01 M7 12h10',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M19.1 4.9L17 7 M7 17l-2.1 2.1',
  warning: 'M12 3l10 18H2z M12 10v5 M12 18h.01',
  leaf: 'M5 19C5 10 10 5 20 4c0 9-5 15-14 15 M5 19c3-5 6-8 10-10',
  calendar: 'M4 6h16v14H4z M4 10h16 M9 3v4 M15 3v4',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2.3-.7-.7-2.3z',
};

/** GameDig id -> pictogram. Games without an entry fall back to their letters. */
export const GAME_ICON: Record<string, keyof typeof ICON_PATHS> = {
  minecraft: 'cube', mbe: 'cube', unturned: 'cube',
  counterstrike2: 'crosshair', csgo: 'crosshair', counterstrike16: 'crosshair', css: 'crosshair', teamfortress2: 'crosshair',
  rust: 'axe', valheim: 'shield', garrysmod: 'wrench', l4d2: 'warning', dayz: 'warning',
  terraria: 'sword', conanexiles: 'sword', sdtd: 'calendar', ase: 'leaf', asa: 'leaf',
  palworld: 'paw', factorio: 'gear', vrising: 'drop', projectzomboid: 'skull',
  gta5f: 'car', gtasam: 'car', teamspeak3: 'headset', icarus: 'planet',
};

export const gameIconPath = (game: string): string | null => {
  const key = GAME_ICON[game];
  return key ? ICON_PATHS[key] : null;
};
