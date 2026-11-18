// Extras when the Field app runs inside the Android app (Capacitor shell in /field-android).
// In a normal browser / installed web app every function here quietly does nothing.
export const isNative = () => !!window.Capacitor?.isNativePlatform?.()

let ln = null
async function notifications() {
  if (!isNative()) return null
  if (!ln) ln = (await import('@capacitor/local-notifications')).LocalNotifications
  return ln
}

// Ask once (Android 13+ shows "Allow CoolerCo Field to send you notifications?")
export async function askNotifications() {
  try {
    const L = await notifications(); if (!L) return
    const p = await L.checkPermissions()
    if (p.display === 'prompt' || p.display === 'prompt-with-rationale') await L.requestPermissions()
  } catch { /* never block the app */ }
}

// A stable whole number per stop (notification ids must be integers)
const idFor = stopId => parseInt(String(stopId).replace(/[^0-9a-f]/gi, '').slice(0, 7) || '1', 16)

// 🔔 "Have you left the store?" on the phone itself — also when it is locked or the app is in the background.
// Same id per stop, so scheduling again (after "still here") replaces the earlier one.
export async function scheduleLeftReminder(stop, atMs) {
  try {
    const L = await notifications(); if (!L) return
    const p = await L.checkPermissions()
    if (p.display !== 'granted') return
    await L.schedule({ notifications: [{
      id: idFor(stop.id), title: '🚪 Have you left the store?',
      body: `${stop.point_of_sale || 'Your stop'} — open the app to record Left, or tell us you are still there.`,
      schedule: { at: new Date(atMs), allowWhileIdle: true },
      extra: { stop_id: stop.id, kind: 'left_reminder' },
    }] })
  } catch { /* never block the app */ }
}
export async function cancelLeftReminder(stopId) {
  try { const L = await notifications(); if (L) await L.cancel({ notifications: [{ id: idFor(stopId) }] }) } catch { /* ignore */ }
}

// Tapping the notification opens the app → go to My trip, where the question is waiting
export async function onReminderTap(cb) {
  try {
    const L = await notifications(); if (!L) return () => {}
    const h = await L.addListener('localNotificationActionPerformed', a => { if (a?.notification?.extra?.kind === 'left_reminder') cb(a.notification.extra) })
    return () => h.remove()
  } catch { return () => {} }
}
