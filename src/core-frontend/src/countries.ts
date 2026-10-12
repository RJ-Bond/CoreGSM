// Countries for the server form: ISO 3166-1 alpha-2 code + Russian name (from the browser's Intl data).
const CODES = [
  'RU', 'UA', 'BY', 'KZ', 'PL', 'DE', 'FR', 'GB', 'NL', 'US', 'CA', 'FI', 'SE', 'NO', 'DK', 'CZ', 'SK', 'HU', 'RO', 'BG', 'RS', 'HR', 'SI',
  'AT', 'CH', 'IT', 'ES', 'PT', 'BE', 'LU', 'IE', 'IS', 'GR', 'TR', 'LT', 'LV', 'EE', 'MD', 'GE', 'AM', 'AZ', 'UZ', 'KG', 'TJ', 'TM', 'MN',
  'IL', 'AE', 'SA', 'QA', 'EG', 'ZA', 'NG', 'MA', 'IN', 'PK', 'BD', 'CN', 'JP', 'KR', 'TW', 'HK', 'SG', 'MY', 'TH', 'VN', 'ID', 'PH',
  'AU', 'NZ', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'CY', 'MT', 'AL', 'MK', 'BA', 'ME',
];

const names = (() => {
  try {
    return new Intl.DisplayNames(['ru'], { type: 'region' });
  } catch {
    return null;
  }
})();

export const COUNTRIES: [string, string][] = CODES.map((c): [string, string] => [c, names?.of(c) ?? c]).sort((a, b) => a[1].localeCompare(b[1], 'ru'));
