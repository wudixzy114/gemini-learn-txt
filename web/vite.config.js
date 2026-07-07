import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // Proxy API calls to the Express backend during development so the
    // frontend can use same-origin relative URLs everywhere.
    proxy: {
      '/api': {
        target: 'http://localhost:8791',
        changeOrigin: true,
      },
    },
  },
});
