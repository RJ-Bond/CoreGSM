/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1e1f22',
        panel: '#2b2d31',
        raise: '#313338',
        line: '#3f4147',
        fg: '#dbdee1',
        mute: '#949ba4',
        blurple: { DEFAULT: '#5865f2', hover: '#4752c4', soft: '#949cf7' },
        ok: '#23a55a',
        warn: '#f0b232',
        bad: '#f23f42',
      },
      fontFamily: { mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
};
