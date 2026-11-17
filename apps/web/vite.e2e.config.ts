import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Automated UI checks only: replaces the AI SDK with a deterministic stand-in.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { 'firebase/ai': fileURLToPath(new URL('./e2e/firebase-ai-stub.ts', import.meta.url)) } },
  build: { outDir: 'e2e/dist' },
});
