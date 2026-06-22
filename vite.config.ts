import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri loads a fixed dev-server URL (src-tauri/tauri.conf.json devUrl); fail loudly
  // rather than silently picking another port if 5173 is taken.
  server: { port: 5173, strictPort: true },
  // Keep the Rust/Tauri console output visible during `tauri dev`.
  clearScreen: false,
})
