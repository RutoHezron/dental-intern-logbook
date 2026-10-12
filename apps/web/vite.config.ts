/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // Registered from main.tsx, and only in the browser: the native app serves its files from the app package.
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Dental Intern Logbook',
        short_name: 'Logbook',
        description: 'Clinical logbook, reflection diary and progressive reports for dental interns.',
        theme_color: '#1b2530',
        background_color: '#f3f5f5',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell is cached so the logbook opens with no signal.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Shows daily reminder notifications (public/push-handler.js).
        importScripts: ['push-handler.js'],
      },
    }),
  ],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
