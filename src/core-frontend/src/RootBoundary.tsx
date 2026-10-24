/**
 * The last line of defence: an error in the shell of the panel (header, navigation, a provider) would otherwise leave a
 * white screen. Shows a calm notice with the details and a reload button instead.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from './i18n';

export class RootBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[coregsm] render error', error, info.componentStack);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n${location.href}\n${navigator.userAgent}`;
    return (
      <div className="grid min-h-screen place-items-center px-4 text-center" role="alert">
        <div className="max-w-md space-y-4">
          <h1 className="text-xl font-extrabold">{t('crash.title')}</h1>
          <p className="text-mute">{t('crash.hint')}</p>
          <pre className="max-h-40 overflow-auto rounded-xl bg-black/20 p-3 text-left text-xs whitespace-pre-wrap">{details}</pre>
          <div className="flex justify-center gap-2">
            <button type="button" className="btn" onClick={() => window.location.reload()}>{t('page.reload')}</button>
            <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(details).catch(() => undefined)}>{t('crash.copy')}</button>
          </div>
        </div>
      </div>
    );
  }
}
