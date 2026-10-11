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
        ink: c('ink'),
        mute: c('mute'),
        line: c('line'),
        soft: c('soft'),
        // brand: fills and buttons; link: brand-coloured text (lighter in the dark theme for contrast)
        brand: { DEFAULT: c('brand'), hover: c('brand-hover') },
        link: c('link'),
        ok: c('ok'),
        okbg: c('okbg'),
        warn: c('warn'),
        warnbg: c('warnbg'),
        bad: c('bad'),
        badbg: c('badbg'),
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Nunito', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { '4xl': '2rem' },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        pop: 'var(--shadow-pop)',
      },
    },
  },
  plugins: [],
};
