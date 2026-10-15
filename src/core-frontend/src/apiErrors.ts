/**
 * The text of an API error in the panel's language. Error answers carry a stable `code` (and `params` for the values
 * of a template) next to the Russian `error` text; English is looked up by the code, Russian is the server's text.
 * A code without a translation (a newer backend) falls back to the server's text.
 */
import { getLang } from './i18n';
import errorsEn from './locales/errors.en';

const fill = (text: string, params: unknown) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params && typeof params === 'object' ? (params as Record<string, unknown>)[k] : undefined;
    return v === undefined || v === null ? '' : String(v);
  });

export function localizeError(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const { error, code, params } = data as { error?: unknown; code?: unknown; params?: unknown };
  if (getLang() === 'en' && typeof code === 'string' && Object.prototype.hasOwnProperty.call(errorsEn, code)) return fill(errorsEn[code], params);
  return typeof error === 'string' ? error : null;
}

/** the message of a failed request read with plain fetch (file uploads): the API's text, else `fallback` */
export const errorText = (data: unknown, fallback: string) => localizeError(data) ?? fallback;
