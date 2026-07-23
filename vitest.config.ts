import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Allows clean imports from your workspace packages or src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Ensures build output directory is placed cleanly inside apps/web/dist
    outDir: 'dist',
    sourcemap: false,
  },
});