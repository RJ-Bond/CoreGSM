import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.COREGSM_API ?? 'http://localhost:3000', '/badge': process.env.COREGSM_API ?? 'http://localhost:3000', '/widget': process.env.COREGSM_API ?? 'http://localhost:3000' } },
  build: {
    rollupOptions: {
      output: {
        // React changes rarely: its own file stays cached in the browser across updates of the panel
        manualChunks: (id) => (/node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react' : undefined),
      },
    },
  },
});
