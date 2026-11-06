/** A page that knows a better name for the tab than its section (a server page: the name of the server) says it here. */
const EVENT = 'coregsm:title';

export function setPageTitleDetail(name: string | null): void {
  window.dispatchEvent(new CustomEvent<string | null>(EVENT, { detail: name }));
}

export function onPageTitleDetail(fn: (name: string | null) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<string | null>).detail ?? null);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** «Servers · Rust | Vanilla · CoreGSM»: the section, the detail when there is one */
export const tabTitle = (section: string, detail: string | null, brand: string): string => [section, detail, brand].filter(Boolean).join(' · ');
