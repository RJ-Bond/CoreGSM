import { forwardRef, type ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** busy: a spinner precedes the label, the button is disabled and announces aria-busy */
  loading?: boolean;
  variant?: 'primary' | 'soft' | 'danger';
  size?: 'md' | 'sm';
  /** leans toward a mouse pointer (key call-to-action buttons only) */
  magnetic?: boolean;
}

export function BtnSpinner() {
  return (
    <svg className="btn-spin animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".28" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** The panel's button: `.btn` styling plus a loading state. `type` is not forced, so a Button inside a form still submits. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { loading = false, variant = 'primary', size = 'md', magnetic = false, className = '', disabled, children, ...rest },
  ref,
) {
  const cls = ['btn', variant === 'soft' ? 'btn-soft' : variant === 'danger' ? 'btn-danger' : '', size === 'sm' ? 'btn-sm' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={ref}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-magnetic={magnetic || undefined}
      {...rest}
    >
      {loading && <BtnSpinner />}
      {children}
    </button>
  );
});
