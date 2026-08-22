import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 is Thrash Margin's client, 5174 is Niccolo, 5175 is The Tea Race.
    port: Number(process.env.PORT) || 5176,
  },
});
