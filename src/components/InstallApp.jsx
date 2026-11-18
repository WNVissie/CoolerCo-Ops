import { useEffect, useState } from 'react'
import { canPrompt, promptInstall, isInstalled, onInstallChange, device } from '../lib/install'

// 📲 Install app: one tap where the phone allows it, otherwise clear steps for each type of device.
// It installs "CoolerCo Field" (scan, my trip, cases) — it opens at /field and works with weak or no signal.
const LINK = () => `${window.location.origin}/field`
const STEPS = {
  ios: { icon: '🍎', label: 'iPhone / iPad', steps: [
    'Open the link in **Safari** (not Chrome or WhatsApp\'s own browser — tap ⋯ → Open in Safari).',
    'Tap the **Share** button ⬆️ at the bottom of the screen.',
    'Scroll down and tap **Add to Home Screen** ➕.',
    'Tap **Add** (top right). The **CoolerCo** icon is now on your home screen.',
    'Open it from the icon and sign in once — it remembers you.',
  ] },
  android: { icon: '🤖', label: 'Android', steps: [
    'Open the link in **Chrome** (or Samsung Internet).',
    'Tap **📲 Install now** below — or tap the menu **⋮** (top right) → **Install app** / **Add to Home screen**.',
    'Tap **Install**. The **CoolerCo** icon appears on your home screen and in your apps.',
    'Open it from the icon and sign in once — it remembers you.',
  ] },
  computer: { icon: '💻', label: 'Computer', steps: [
    'Use **Chrome** or **Edge**.',
    'Tap **📲 Install now** below — or click the **install icon** 🖥️⬇ at the right end of the address bar (Edge: ⋯ → Apps → Install).',
    'Click **Install**. CoolerCo Field opens in its own window and gets a desktop / taskbar icon.',
  ] },
}
// Android app for company phones (built on GitHub from /field-android; same Field app inside, plus reminders on a locked phone)
export const APK_URL = 'https://github.com/WNVissie/CoolerCo-Ops/releases/download/field-android-latest/CoolerCo-Field.apk'
const APK_STEPS = [
  'On the phone, open this page in **Chrome** and tap **⬇ Download the Android app**.',
  'Open the downloaded **CoolerCo-Field.apk** (pull down the notifications → tap it).',
  'If asked, allow **Chrome** to **install unknown apps** (Settings opens — switch it on, then go back).',
  'Samsung: if it says it is blocked, switch off **Settings → Security and privacy → Auto Blocker**, install, then switch it on again.',
  'Tap **Install**, open **CoolerCo Field**, sign in once and **Allow** location, camera and notifications.',
]
const bold = t => t.split('**').map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))

export default function InstallApp({ onClose }) {
  const [, tick] = useState(0)
  const [tab, setTab] = useState(() => device().kind)
  const [msg, setMsg] = useState(null)
  const [qr, setQr] = useState(null)
  useEffect(() => onInstallChange(() => tick(n => n + 1)), [])
  useEffect(() => { import('qrcode').then(QR => QR.toDataURL(LINK(), { width: 180, margin: 1 })).then(setQr).catch(() => {}) }, [])
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])

  const installed = isInstalled()
  async function install() {
    const r = await promptInstall()
    setMsg(r === 'accepted' ? { type: 'ok', text: '✅ Installed — find CoolerCo on your home screen.' } : r === 'dismissed' ? { type: 'warn', text: 'Not installed. You can try again any time.' } : null)
  }
  const wa = `https://wa.me/?text=${encodeURIComponent(`📲 Install the CoolerCo Field app (scan assets, my trip, cases): ${LINK()}\niPhone: open in Safari → Share ⬆️ → Add to Home Screen.\nAndroid: open in Chrome → ⋮ → Install app.`)}`

  return (
    <div className="drawer-overlay install-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="card install-modal" role="dialog" aria-label="Install the app">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/icons/icon-192.png" alt="" width={40} height={40} style={{ borderRadius: 10 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>Install CoolerCo Field</div>
            <div className="text3" style={{ fontSize: 11 }}>Scan assets · My trip · Cases — opens fast, works with weak or no signal</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {installed
          ? <div className="form-msg ok" style={{ marginTop: 12 }}>✅ You are using the installed app on this device.</div>
          : canPrompt() && <button className="btn btn-primary" style={{ width: '100%', marginTop: 12, fontSize: 15, padding: 12 }} onClick={install}>📲 Install now</button>}
        {msg && <div className={`form-msg ${msg.type}`} style={{ marginTop: 8 }}>{msg.text}</div>}

        <div className="seg" style={{ marginTop: 14 }}>
          {Object.entries(STEPS).map(([k, v]) => <button key={k} className={`seg-btn${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{v.icon} {v.label}</button>)}
        </div>
        <ol className="install-steps">{STEPS[tab].steps.map((s, i) => <li key={i}>{bold(s)}</li>)}</ol>
        {tab === 'android' && (
          <details className="sec" style={{ marginTop: 10 }} open>
            <summary>🤖 Android app for company phones (recommended)</summary>
            <div className="sec-body">
              <div className="text3" style={{ fontSize: 11, marginBottom: 6 }}>The same Field app as a real Android app: it also reminds the driver "Have you left the store?" when the phone is locked.</div>
              <a className="btn btn-primary btn-sm" href={APK_URL}>⬇ Download the Android app</a>
              <ol className="install-steps">{APK_STEPS.map((s, i) => <li key={i}>{bold(s)}</li>)}</ol>
            </div>
          </details>
        )}

        <details className="sec" style={{ marginTop: 10 }}>
          <summary>📤 Put it on someone else's phone</summary>
          <div className="sec-body" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {qr && <img src={qr} alt="QR code to the app" width={120} height={120} />}
            <div style={{ display: 'grid', gap: 6, flex: 1, minWidth: 160 }}>
              <div className="text3" style={{ fontSize: 11 }}>Scan the QR with the phone camera, or send the link:</div>
              <code className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{LINK()}</code>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(LINK()).then(() => setMsg({ type: 'ok', text: '📋 Link copied' }))}>📋 Copy link</button>
                <a className="btn btn-primary btn-sm" href={wa} target="_blank" rel="noreferrer">💬 WhatsApp</a>
              </div>
            </div>
          </div>
        </details>
        <div className="text3" style={{ fontSize: 10.5, marginTop: 8 }}>Same sign-in as this app. Updates arrive by themselves — no app store needed.</div>
      </div>
    </div>
  )
}
