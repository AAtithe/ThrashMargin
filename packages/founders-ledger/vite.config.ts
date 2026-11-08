import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 Thrash Margin, 5174 Niccolo, 5175 The Tea Race, 5176 Steady Eddie, 5177 Niccolo Rising,
    // 5178 Fireline. This was 5177 too, so the Ledger and Niccolo Rising could not run side by side.
    port: Number(process.env.PORT) || 5179,
  },
});
