/* global __APP_VERSION__ */
// "Is there a newer version of the app?" + "update now".
// Each build writes /version.json (build time, UTC). The running app knows its own build time.
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

export async function latestVersion() {
  try {
    const r = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()).version || null
  } catch { return null }
}

export async function updateAvailable() {
  if (APP_VERSION === 'dev' || !navigator.onLine) return false
  const v = await latestVersion()
  return !!v && v !== APP_VERSION
}

// Fetch the newest app and restart it. Waiting scans / taps (IndexedDB) and the sign-in are kept;
// only the saved copy of the app itself is thrown away.
export async function updateNow() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    await reg?.update()
  } catch { /* no service worker */ }
  try { for (const k of await caches.keys()) await caches.delete(k) } catch { /* no caches */ }
  const u = new URL(location.href); u.searchParams.set('v', Date.now())
  location.replace(u.toString())
}

// Version shown to users: build time in South African time, e.g. "17 Nov 00:24"
export function versionLabel(v = APP_VERSION) {
  if (v === 'dev') return 'dev'
  const d = new Date(v.replace(' ', 'T') + 'Z')
  return isNaN(d) ? v : d.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
