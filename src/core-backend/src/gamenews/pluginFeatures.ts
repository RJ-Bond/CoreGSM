/** What the game plugin can do, and since which version: the panel tells what an old plugin on a server is missing. */

export interface PluginFeature { id: string; since: string }

/** from the history of the plugin: the version that brought the thing the panel relies on */
export const PLUGIN_FEATURES: PluginFeature[] = [
  { id: 'chat', since: '0.8.0' },
  { id: 'joins', since: '0.9.0' },
  { id: 'restart', since: '0.10.0' },
  { id: 'kick', since: '0.13.0' },
  { id: 'reminders', since: '0.15.0' },
  { id: 'palette', since: '0.17.0' },
  { id: 'connections', since: '0.17.1' },
  { id: 'selfUpdate', since: '0.18.0' },
  { id: 'rconRestart', since: '0.18.10' },
  { id: 'metrics', since: '0.18.11' },
  { id: 'delivery', since: '0.18.11' },
  { id: 'network', since: '0.18.12' },
];

const parts = (v: string): number[] | null => (/^\d+(\.\d+){1,3}$/.test(v) ? v.split('.').map(Number) : null);

/** negative when a < b; null when either is not a readable version */
export function cmpPlugin(a: string, b: string): number | null {
  const x = parts(a);
  const y = parts(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** the features a plugin of this version does not have yet; an unknown version (never polled) says nothing */
export function missingFeatures(version: string): PluginFeature[] {
  if (!parts(version)) return [];
  return PLUGIN_FEATURES.filter((f) => (cmpPlugin(version, f.since) ?? 0) < 0);
}

/** does the plugin of this version have the feature; true when the version is unknown, so nothing is hidden by mistake */
export function hasFeature(version: string, id: string): boolean {
  const f = PLUGIN_FEATURES.find((x) => x.id === id);
  if (!f || !parts(version)) return true;
  return (cmpPlugin(version, f.since) ?? 0) >= 0;
}
