import type { ReactNode } from 'react';
import { t } from '../i18n';
import { AuthBrand } from '../ui';

/** the card of the e-mail flows (forgot / reset / verify): brand, a title and a way back to sign in */
export default function AuthFlow({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="auth-card w-full max-w-sm rounded-[28px] border bg-card p-6 sm:p-7">
      <AuthBrand subtitle={subtitle} />
      <h1 className="mb-4 text-center text-xl font-black">{title}</h1>
      <div className="space-y-4">{children}</div>
      <p className="mt-5 text-center text-sm font-bold">
        <a href="/login" className="inline-flex items-center text-link hover:underline max-sm:min-h-[44px]">{t('forgot.back')}</a>
      </p>
    </div>
  );
}
