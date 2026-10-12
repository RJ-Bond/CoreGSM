import type { InputHTMLAttributes } from 'react';

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'checked' | 'type' | 'role'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * iOS-style on/off switch for a boolean setting. A real checkbox with role="switch": Space toggles it, a wrapping <label>
 * works, the focus ring is the normal one. Give it an aria-label or put it inside a <label> with text.
 * (Selecting rows from a list stays a plain checkbox.)
 */
export function Switch({ checked, onChange, className = '', ...rest }: SwitchProps) {
  return (
    <input
      {...rest}
      type="checkbox"
      role="switch"
      className={`switch ${className}`.trim()}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}
