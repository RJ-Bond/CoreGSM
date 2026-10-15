/**
 * Attributes for fields that hold a secret of something else (the Discord bot token, the Client Secret, the SMTP
 * password) and the fields next to them (proxy, SMTP login). Browsers ignore autocomplete="off" on a password
 * field: they put the panel's own saved login into the text field before it and the panel's password into the
 * field, and saving the form then overwrote the token and the proxy with them. "new-password" stops the browser
 * from filling saved passwords; the data-* attributes do the same for 1Password, LastPass and Bitwarden.
 */
export const noAutofill = (secret = false) =>
  ({
    autoComplete: secret ? 'new-password' : 'off',
    'data-1p-ignore': 'true',
    'data-lpignore': 'true',
    'data-bwignore': 'true',
    'data-form-type': 'other',
  }) as const;
