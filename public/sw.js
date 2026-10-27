// CoolerCo service worker — keeps the app itself on the phone so it opens fast and without signal.
// Data (Supabase) is never cached here; offline scans are queued by the app in IndexedDB.
const VERSION = 'cc-v1'
const SHELL = ['/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})

const timeout = (ms, p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // Supabase etc. — always live

  // Pages: newest version when online (4 s), the saved one when not
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await timeout(4000, fetch(req))
        if (res.ok) (await caches.open(VERSION)).put('/index.html', res.clone())
        return res
      } catch {
        return (await caches.match('/index.html')) || Response.error()
      }
    })())
    return
  }

  // Built files have unique names: keep forever once fetched
  if (url.pathname.startsWith('/static/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)) }
      return res
    })))
    return
  }

  // Icons, manifest: saved copy now, refresh in the background
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)) } return res }).catch(() => hit)
      return hit || net
    }))
  }
})
