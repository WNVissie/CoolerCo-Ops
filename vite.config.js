import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Build files live in /static (not /assets) so they never clash with the /assets page route
  build: { assetsDir: 'static' },
})
