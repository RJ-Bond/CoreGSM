import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // COREGSM_POLL=1: the local Docker stand, where files changed in Windows send no events into the container
  server: { watch: process.env.COREGSM_POLL ? { usePolling: true, interval: 300 } : undefined, proxy: { '/api': process.env.COREGSM_API ?? 'http://localhost:3000', '/badge': process.env.COREGSM_API ?? 'http://localhost:3000', '/widget': process.env.COREGSM_API ?? 'http://localhost:3000' } },
  build: {
    rollupOptions: {
      output: {
        // React changes rarely: its own file stays cached in the browser across updates of the panel
        manualChunks: (id) => (/node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react' : undefined),
      },
    },
  },
});
