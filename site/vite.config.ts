import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Multi-page static build (Vite's native support, no router dependency
    // needed for one extra page) -- roles.html is the disclosure page
    // linked from the footer and from buyer-app's create-commitment
    // consent checkbox.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        roles: resolve(import.meta.dirname, 'roles.html'),
      },
    },
  },
})
