/** @type {import('tailwindcss').Config} */
// Colours come from CSS variables (see index.css), so one set of classes serves both the light and the dark theme.
const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: c('page'),
        card: c('card'),
        // floating surfaces (dialogs, menus): one step above the card in the dark theme, equal to it in the light one
        raised: c('raised'),
        ink: c('ink'),
        mute: c('mute'),
        line: c('line'),
        // input borders: >= 3:1 against the card (line is decorative only)
        field: c('field'),
        soft: c('soft'),
        // brand: fills and buttons; brand-2: the darker end of brand gradients; link: brand-coloured text (lighter in the dark theme for contrast)
        brand: { DEFAULT: c('brand'), hover: c('brand-hover'), 2: c('brand-2') },
        link: c('link'),
        ok: c('ok'),
        okbg: c('okbg'),
        warn: c('warn'),
        warnbg: c('warnbg'),
        bad: c('bad'),
        // filled red buttons: white text >= 4.5:1 in both themes
        badsolid: c('badsolid'),
        badbg: c('badbg'),
      },
      fontFamily: {
        sans: ['"Manrope Variable"', 'Manrope', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      // radius scale: rounded-ui-sm / -md / -lg / -xl / -pill (values in index.css); the stock rounded-* names stay as they were
      borderRadius: {
        '4xl': '2rem',
        tile: 'var(--r-xl)',
        'ui-sm': 'var(--r-sm)',
        'ui-md': 'var(--r-md)',
        'ui-lg': 'var(--r-lg)',
        'ui-xl': 'var(--r-xl)',
        'ui-pill': 'var(--r-pill)',
      },
      // shadow scale: shadow-1 (small controls), shadow-2 (cards at rest), shadow-3 (floating); soft / pop are the old names
      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
        3: 'var(--shadow-3)',
        soft: 'var(--shadow-soft)',
        pop: 'var(--shadow-pop)',
      },
    },
  },
  plugins: [],
};
