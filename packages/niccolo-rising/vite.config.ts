import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 Thrash Margin, 5174 Niccolò, 5175 The Tea Race, 5176 Steady Eddie.
    port: Number(process.env.PORT) || 5177,
  },
});
