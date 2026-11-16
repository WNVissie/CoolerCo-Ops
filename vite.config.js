import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Version stamp: the build time. Written to /version.json so open apps can see a newer version is out.
const VERSION = new Date().toISOString().slice(0, 16).replace('T', ' ')
const versionFile = () => ({
  name: 'cc-version-file',
  generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION }) }) },
})

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  // Build files live in /static (not /assets) so they never clash with the /assets page route
  build: { assetsDir: 'static' },
})
