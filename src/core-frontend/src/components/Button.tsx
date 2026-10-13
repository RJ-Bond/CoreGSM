import { forwardRef, type ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** busy: a spinner precedes the label, the button is disabled and announces aria-busy */
  loading?: boolean;
  /** primary (default) is the one main action of a view; soft / outline are secondary, ghost is tertiary, danger* destroys, link is an inline text action */
  variant?: 'primary' | 'soft' | 'outline' | 'ghost' | 'danger' | 'danger-solid' | 'success' | 'success-solid' | 'warn' | 'link';
  /** xs 28px, sm 34px (toolbars), md 42px (forms, default), lg 50px */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** full width */
  block?: boolean;
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

/** The panel's button: button-system styling (see styles/buttons.css) plus a loading state. `type` is not forced, so a Button inside a form still submits. */
const VARIANT_CLASS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'btn',
  soft: 'btn btn-soft',
  outline: 'btn btn-outline',
  ghost: 'btn btn-ghost',
  danger: 'btn btn-danger',
  'danger-solid': 'btn btn-danger-solid',
  success: 'btn btn-success',
  'success-solid': 'btn btn-success-solid',
  warn: 'btn btn-warn',
  link: 'btn-link',
};
const SIZE_CLASS = { xs: 'btn-xs', sm: 'btn-sm', md: '', lg: 'btn-lg' } as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { loading = false, variant = 'primary', size = 'md', block = false, magnetic = false, className = '', disabled, children, ...rest },
  ref,
) {
  const cls = [VARIANT_CLASS[variant], SIZE_CLASS[size], block ? 'btn-block' : '', className]
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
