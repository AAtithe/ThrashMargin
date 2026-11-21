import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // React in its own file: it rarely changes, so a phone keeps it cached across deploys while
        // the engine (its own chunk, loaded by LedgerScreen) is the only thing re-downloaded.
        manualChunks: id => (/node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react' : undefined),
      },
    },
  },
  server: {
    // 5173 Thrash Margin, 5174 Niccolo, 5175 The Tea Race, 5176 Steady Eddie, 5177 Niccolo Rising,
    // 5178 Fireline. This was 5177 too, so the Ledger and Niccolo Rising could not run side by side.
    port: Number(process.env.PORT) || 5179,
  },
});
