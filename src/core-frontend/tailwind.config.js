/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: '#f1effe',
        card: '#ffffff',
        ink: '#2b2650',
        mute: '#7a74a8',
        line: '#e2defa',
        soft: '#ece9ff',
        brand: { DEFAULT: '#5a4bd1', hover: '#4a3cb8' },
        ok: '#168a4f',
        okbg: '#d9f7e6',
        warn: '#b27300',
        warnbg: '#fff0cc',
        bad: '#c53030',
        badbg: '#ffdede',
      },
      fontFamily: {
        sans: ['Nunito', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { '4xl': '2rem' },
      boxShadow: {
        soft: '0 8px 28px rgba(90, 75, 209, 0.09)',
        pop: '0 2px 10px rgba(90, 75, 209, 0.12)',
      },
    },
  },
  plugins: [],
};
