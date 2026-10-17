/**
 * Ready-made themes: the brand colour and the end of its gradient, and for the game themes also the glow along the
 * page and, for games that ship a cover, a faint picture across the top of every page.
 */
export interface ThemePreset { id: string; name: string; c1: string; c2: string; game?: string; glow?: string; art?: string }

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'indigo', name: 'Индиго', c1: '#4f46e5', c2: '#3730a3' },
  { id: 'emerald', name: 'Изумруд', c1: '#059669', c2: '#047857' },
  { id: 'sunset', name: 'Закат', c1: '#ea580c', c2: '#be185d' },
  { id: 'ocean', name: 'Океан', c1: '#0284c7', c2: '#1d4ed8' },
  { id: 'fuchsia', name: 'Фуксия', c1: '#c026d3', c2: '#7e22ce' },
  { id: 'graphite', name: 'Графит', c1: '#475569', c2: '#0f172a' },
];

export const GAME_PRESETS: ThemePreset[] = [
  { id: 'g-vrising', name: 'V Rising: кровавая луна', game: 'vrising', c1: '#c0262d', c2: '#5b0a1f', glow: 'rgb(220 38 38 / 0.28)', art: '/games/covers/vrising.jpg' },
  { id: 'g-icarus', name: 'Icarus: рассвет', game: 'icarus', c1: '#d97706', c2: '#7c2d12', glow: 'rgb(245 158 11 / 0.26)', art: '/games/covers/icarus.jpg' },
  // white text on the brand colour must stay >= 4.5:1, so the gold is the dark one
  { id: 'g-m2o', name: 'Mafia II: ночной порт', game: 'm2o', c1: '#8a6420', c2: '#4a3410', glow: 'rgb(201 162 74 / 0.26)', art: '/games/covers/m2o.jpg' },
  { id: 'g-rust', name: 'Rust: ржавчина', game: 'rust', c1: '#cd4a1f', c2: '#4a1608', glow: 'rgb(234 88 12 / 0.24)' },
  { id: 'g-minecraft', name: 'Minecraft: трава', game: 'minecraft', c1: '#3f9b2f', c2: '#1d4d18', glow: 'rgb(74 222 128 / 0.2)' },
  { id: 'g-cs2', name: 'CS2: тактика', game: 'counterstrike2', c1: '#d69e14', c2: '#253246', glow: 'rgb(234 179 8 / 0.2)' },
  { id: 'g-palworld', name: 'Palworld: лагуна', game: 'palworld', c1: '#0e9fb8', c2: '#0b4f66', glow: 'rgb(34 211 238 / 0.22)' },
];

export const presetById = (id: string | undefined | null) => [...THEME_PRESETS, ...GAME_PRESETS].find((p) => p.id === id) ?? null;

/** the extras of a game theme on the page: the glow colour and the picture; other themes take them away */
export function paintGameTheme(id: string | undefined | null): void {
  const root = document.documentElement;
  const p = presetById(id);
  if (p?.glow) root.style.setProperty('--horizon-b', p.glow);
  else root.style.removeProperty('--horizon-b');
  if (p?.art) {
    root.style.setProperty('--game-art', `url("${p.art}")`);
    root.dataset.gameArt = '1';
  } else {
    root.style.removeProperty('--game-art');
    delete root.dataset.gameArt;
  }
}
