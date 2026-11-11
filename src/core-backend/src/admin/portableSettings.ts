/**
 * The settings a person sets in the panel: they travel with the exported file and their changes are written to the
 * history of the settings. Never a secret, never a counter or a timestamp of this panel. (No imports here: db.ts uses it.)
 */
export const PORTABLE_SETTINGS = [
  'alerts_enabled', 'alerts_channel', 'alerts_system_channel', 'default_look', 'alerts_after_min', 'alerts_mention', 'alerts_smart_low', 'alerts_smart_ping', 'alerts_smart_full',
  'digest_enabled', 'digest_channel', 'digest_weekday', 'digest_hour', 'digest_theme',
  'brand_name', 'brand_color', 'brand_preset', 'default_theme', 'game_theme',
  'news_channel_id', 'news_test_channel_id', 'embed_players_shown',
  'poll_concurrency', 'poll_fail_threshold', 'poll_fail_n', 'poll_fail_m', 'poll_probe_veto', 'timezone',
  'public_panel', 'registration_open', 'registration_mode', 'rules_text',
  'backup_schedule', 'backup_keep',
  'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from',
] as const;

const SET = new Set<string>(PORTABLE_SETTINGS);
export const isHistoryKey = (key: string): boolean => SET.has(key);
