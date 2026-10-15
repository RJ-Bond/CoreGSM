/**
 * Pages loaded on demand: the first screen (the server list) does not wait for the admin area, the news editor or
 * the profile. After an update of the panel an open tab may ask for a chunk that no longer exists: the page then
 * reloads once to pick up the new build; a second failure shows a notice with a button instead of a blank screen.
 */
import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { t } from './i18n';
import { Spinner } from './ui';

const RELOADED = 'coregsm_chunk_reload';

export function lazyPage<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  return lazy(async (): Promise<{ default: ComponentType<P> }> => {
    try {
      const m = await load();
      try { sessionStorage.removeItem(RELOADED); } catch { /* private mode */ }
      return m;
    } catch (e) {
      let again = true;
      try {
        again = sessionStorage.getItem(RELOADED) === '1';
        if (!again) sessionStorage.setItem(RELOADED, '1');
      } catch {
        /* no storage: do not risk a reload loop */
      }
      if (again) throw e;
      window.location.reload();
      return new Promise(() => undefined);
    }
  });
}

class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-[40vh] place-items-center text-center" role="alert">
        <div className="space-y-3">
          <p className="font-extrabold">{t('page.loadFailed')}</p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>{t('page.reload')}</button>
        </div>
      </div>
    );
  }
}

/** the frame around a lazy page: a quiet spinner while its code loads */
export function PageFrame({ children }: { children: ReactNode }) {
  return (
    <PageBoundary>
      <Suspense
        fallback={
          <div className="grid min-h-[40vh] place-items-center text-mute" role="status" aria-label={t('hdr.loading')}>
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        {children}
      </Suspense>
    </PageBoundary>
  );
}
