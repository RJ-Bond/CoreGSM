import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.COREGSM_API ?? 'http://localhost:3000', '/badge': process.env.COREGSM_API ?? 'http://localhost:3000', '/widget': process.env.COREGSM_API ?? 'http://localhost:3000' } },
  test: {
    // `npm run coverage` (and CI) fail when the coverage of the files the tests load falls below the floor: it may only be raised
    coverage: { reporter: ['text-summary', 'text'], thresholds: { statements: 40, branches: 33, functions: 34, lines: 44 } },
  },
  build: {
    rollupOptions: {
      output: {
        // React changes rarely: its own file stays cached in the browser across updates of the panel
        manualChunks: (id) => (/node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react' : undefined),
      },
    },
  },
});
