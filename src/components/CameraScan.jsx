import { useEffect, useRef, useState } from 'react'

// Full-screen camera scanner for QR codes and normal barcodes.
// Uses the phone's built-in reader (BarcodeDetector, Android Chrome) when available,
// otherwise zxing-cpp/WebAssembly (iPhone Safari, older phones) — loaded only when the camera opens.
// The fallback reads only the area inside the white frame, at the camera's full sharpness (1920 px).
const FORMATS = ['qr_code', 'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'data_matrix']

// continuous: keep the camera open after a read (Quick scan) — the same code is ignored for 4 s,
// and while `paused` (a decision is waiting) nothing is read. `children` are shown over the camera.
export default function CameraScan({ onResult, onClose, continuous = false, paused = false, children }) {
  const videoRef = useRef(null)
  const [err, setErr] = useState(null)
  const [torch, setTorch] = useState(null) // null = not supported
  const stop = useRef(() => {})
  const done = useRef(false)
  const pausedRef = useRef(paused)
  const last = useRef({ text: '', at: 0 })
  const resume = useRef(() => {})
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult // latest handler without restarting the camera on every render
  useEffect(() => { pausedRef.current = paused }, [paused])

  useEffect(() => {
    let alive = true
    const finish = text => {
      if (done.current || !text || pausedRef.current) return
      const t = String(text).trim()
      if (continuous && t === last.current.text && Date.now() - last.current.at < 4000) return
      done.current = true
      try { navigator.vibrate?.(80) } catch { /* ignore */ }
      if (!continuous) { stop.current(); onResultRef.current(t); return }
      last.current = { text: t, at: Date.now() }
      onResultRef.current(t)
      setTimeout(() => { done.current = false; resume.current() }, 1200)
    }
    ;(async () => {
      try {
        const native = 'BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats?.() || []).includes('qr_code')
        if (native) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
          if (!alive) { stream.getTracks().forEach(t => t.stop()); return }
          const v = videoRef.current; v.srcObject = stream; await v.play()
          const track = stream.getVideoTracks()[0]
          if (track.getCapabilities?.().torch) setTorch(false)
          const supported = await window.BarcodeDetector.getSupportedFormats()
          const det = new window.BarcodeDetector({ formats: FORMATS.filter(f => supported.includes(f)) })
          let raf
          const tick = async () => {
            if (!alive || done.current) return
            try { const codes = await det.detect(v); if (codes[0]?.rawValue) finish(codes[0].rawValue) } catch { /* frame not ready */ }
            if (!done.current) raf = setTimeout(tick, 120) // keeps looking while paused or after an ignored repeat
          }
          resume.current = () => { clearTimeout(raf); tick() }
          tick()
          stop.current = () => { clearTimeout(raf); stream.getTracks().forEach(t => t.stop()) }
        } else {
          const [{ readFrame, loadReader }, stream] = await Promise.all([
            import('../lib/zxingReader').then(m => { m.loadReader(); return m }),
            navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }),
          ])
          if (!alive) { stream.getTracks().forEach(t => t.stop()); return }
          const v = videoRef.current; v.srcObject = stream; await v.play()
          const track = stream.getVideoTracks()[0]
          try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }) } catch { /* not supported */ }
          if (track.getCapabilities?.().torch) setTorch(false)
          await loadReader()
          const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true })
          let raf, busy = false
          // the white frame is a centred square, 72% of the narrower screen side (max 300 px) — map it onto the video
          const frameCrop = () => {
            const vw = v.videoWidth, vh = v.videoHeight, sw = v.clientWidth || window.innerWidth, sh = v.clientHeight || window.innerHeight
            const scale = Math.max(sw / vw, sh / vh) // object-fit: cover
            const side = Math.min(sw * 0.72, 300) * 1.25 / scale // a little margin around the frame
            const sx = Math.max(0, (vw - side) / 2), sy = Math.max(0, (vh - side) / 2)
            return [sx, sy, Math.min(side, vw), Math.min(side, vh)]
          }
          const tick = async () => {
            if (!alive || done.current) return
            if (!busy && v.videoWidth) {
              busy = true
              try {
                const [sx, sy, w, h] = frameCrop()
                canvas.width = Math.round(w); canvas.height = Math.round(h)
                ctx.drawImage(v, sx, sy, w, h, 0, 0, canvas.width, canvas.height)
                const text = await readFrame(ctx.getImageData(0, 0, canvas.width, canvas.height))
                if (text) finish(text)
              } catch { /* frame not ready */ }
              busy = false
            }
            if (!done.current) raf = setTimeout(tick, 150)
          }
          resume.current = () => { clearTimeout(raf); tick() }
          tick()
          stop.current = () => { clearTimeout(raf); stream.getTracks().forEach(t => t.stop()) }
        }
      } catch (e) {
        setErr(/denied|permission|notallowed/i.test(e?.name + e?.message)
          ? 'Camera permission was refused. Allow the camera for this site in your browser settings, or type the code instead.'
          : 'Could not start the camera: ' + (e?.message || e))
      }
    })()
    return () => { alive = false; stop.current() }
  }, [continuous]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleTorch() {
    const track = videoRef.current?.srcObject?.getVideoTracks?.()[0]
    if (!track) return
    try { await track.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch) } catch { /* ignore */ }
  }

  return (
    <div className="cam-overlay" role="dialog" aria-label="Scan code">
      <video ref={videoRef} className="cam-video" playsInline muted />
      <div className="cam-frame"><span /></div>
      <div className="cam-top">
        <span>📷 Point at the QR code or barcode</span>
        <button className="cam-btn" onClick={() => { stop.current(); onClose() }} aria-label="Close">✕</button>
      </div>
      {children && <div className="cam-card">{children}</div>}
      <div className="cam-bottom">
        {err ? <div className="cam-err">{err}</div> : <small>Hold steady about 10–20 cm away · it reads automatically</small>}
        {torch !== null && <button className="cam-btn" onClick={toggleTorch}>{torch ? '🔦 Light off' : '🔦 Light on'}</button>}
      </div>
    </div>
  )
}

// What could a scanned code be? QR codes may hold a URL or text — pull out the likely asset keys.
export function codeCandidates(raw) {
  const s = String(raw || '').trim()
  if (!s) return []
  const out = new Set([s])
  const ast = s.match(/AST-[\w-]+/i); if (ast) out.add(ast[0].toUpperCase())
  try {
    const u = new URL(s)
    u.pathname.split('/').filter(Boolean).forEach(p => out.add(decodeURIComponent(p)))
    u.searchParams.forEach(v => out.add(v))
  } catch { /* not a URL */ }
  s.split(/[\s;,|]+/).forEach(p => p && out.add(p))
  ;(s.match(/[A-Z0-9]{5,}/gi) || []).forEach(p => out.add(p))
  return [...out].filter(x => x.length >= 3 && x.length <= 80).slice(0, 12)
}
