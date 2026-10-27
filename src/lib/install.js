// "Install the app" helper. The browser offers its own install prompt only once and only early,
// so we catch it here (main.jsx imports this first) and keep it until a user taps 📲 Install app.
let deferred = null
const listeners = new Set()
const emit = () => listeners.forEach(f => f())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; emit() })
  window.addEventListener('appinstalled', () => { deferred = null; try { localStorage.setItem('cc_installed', '1') } catch { /* ignore */ } emit() })
}

export const onInstallChange = f => { listeners.add(f); return () => listeners.delete(f) }
export const canPrompt = () => Boolean(deferred)
export const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

export async function promptInstall() {
  if (!deferred) return 'unavailable'
  deferred.prompt()
  const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }))
  deferred = null; emit()
  return outcome // 'accepted' | 'dismissed'
}

// Which instructions to show first
export function device() {
  const ua = navigator.userAgent
  const ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  if (ios) return { kind: 'ios', safari: !/crios|fxios|edgios/i.test(ua) }
  if (/android/i.test(ua)) return { kind: 'android', samsung: /samsungbrowser/i.test(ua) }
  return { kind: 'computer', edge: /edg\//i.test(ua) }
}
