import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // DENTRO do container `localhost` é o próprio container (ECONNREFUSED
        // -> 500 em toda chamada /api relativa). Como o compose define
        // VITE_API_URL, nesse caso o alvo vira o serviço da API pelo DNS do
        // Docker; na host (npm run dev local) fica localhost:3001.
        target:
          process.env.VITE_PROXY_TARGET ||
          (process.env.VITE_API_URL ? 'http://papatec-api:3001' : 'http://localhost:3001'),
        changeOrigin: true,
      },
    },
  },
});