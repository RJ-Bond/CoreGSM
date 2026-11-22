/** A short readable name of a server for links: «rust-main» in /s/rust-main and /servers/rust-main. The number still works. */

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MIN = 2;
export const SLUG_MAX = 40;

/** why a slug is not good, or null; a slug of digits only would be taken for a number */
export function slugProblem(raw: string): 'format' | 'number' | null {
  const s = raw.trim();
  if (s.length < SLUG_MIN || s.length > SLUG_MAX || !SLUG_RE.test(s)) return 'format';
  if (/^\d+$/.test(s)) return 'number';
  return null;
}

const TRANSLIT: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

/** a suggestion from the title: «Мой Rust #1» → «moy-rust-1» */
export function slugFrom(title: string): string {
  const latin = Array.from(title.toLowerCase()).map((c) => TRANSLIT[c] ?? c).join('');
  return latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX).replace(/-+$/, '');
}
