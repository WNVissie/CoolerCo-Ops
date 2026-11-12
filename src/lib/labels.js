// Asset labels — re-print the COM barcode (Wanda: QR + the number in text) for a Brother P-touch, 24 mm TZe tape.
// Browser: the label is drawn here (canvas) — no server needed. Two ways to print:
//  1. one label  → PNG image → phone "Share" → Brother app (iPrint&Label / Design&Print), or download on a PC
//  2. a batch    → CSV for P-touch Editor (PC): link it to a template with a QR + text field, print the run in bay order

// 24 mm tape prints about 18 mm high. Drawn at 360 dpi: 18 mm ≈ 255 px. Width ≈ 58 mm.
const DPI = 360
const mm = v => Math.round(v / 25.4 * DPI)
const H = mm(18), W = mm(58)

export async function labelPng({ bar_code, local_code, model, warehouse }) {
  const QR = await import('qrcode')
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
  // QR = exactly what the current labels hold: the barcode number
  const qr = document.createElement('canvas')
  await QR.toCanvas(qr, String(bar_code), { errorCorrectionLevel: 'M', margin: 0, width: H, color: { dark: '#000', light: '#fff' } })
  g.drawImage(qr, 0, 0, H, H)
  // Text: the number big, then local code / model / warehouse small (for a quick "right cooler?" check)
  const x = H + mm(2.5), maxW = W - x - mm(1)
  g.fillStyle = '#000'; g.textBaseline = 'top'
  let size = mm(8)
  g.font = `700 ${size}px Arial, Helvetica, sans-serif`
  while (g.measureText(bar_code).width > maxW && size > mm(4)) { size -= 2; g.font = `700 ${size}px Arial, Helvetica, sans-serif` }
  g.fillText(String(bar_code), x, mm(0.6))
  const small = mm(2.6)
  g.font = `400 ${small}px Arial, Helvetica, sans-serif`
  const lines = [local_code && `Local ${local_code}`, model, warehouse].filter(Boolean)
  lines.slice(0, 3).forEach((t, i) => {
    let s = String(t)
    while (g.measureText(s).width > maxW && s.length > 4) s = s.slice(0, -2)
    g.fillText(s === String(t) ? s : s + '…', x, mm(0.6) + size + mm(0.8) + i * (small + mm(0.5)))
  })
  return new Promise(res => c.toBlob(res, 'image/png'))
}

// Phone: hand the image to the Brother app (Share sheet). PC / no share: download it.
export async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared' } catch (e) { if (e?.name === 'AbortError') return 'cancelled' }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return 'downloaded'
}

export async function printLabel(asset) {
  const blob = await labelPng({
    bar_code: asset.bar_code, local_code: asset.local_code,
    model: asset.product_variant || asset.product_base,
    warehouse: asset.warehouse || String(asset.assign_account || '').replace(/^RTMA\s+/, ''),
  })
  return shareOrDownload(blob, `label-${asset.bar_code}.png`)
}

// P-touch Editor database file (CSV, UTF-8 with BOM so Excel and P-touch read it cleanly)
export function ptouchCsv(rows, name) {
  const cols = ['Barcode', 'LocalCode', 'Model', 'Warehouse', 'Bay', 'Area']
  const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const body = rows.map(r => [r.bar_code, r.local_code, r.product_variant || r.product_base, `${r.warehouse}${r.ws ? ' WS' : ' WH'}`, r.bay, r.last_area].map(esc).join(','))
  const blob = new Blob(['﻿' + [cols.join(','), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// Was this code typed by a person, or fed in by a hand scanner? Scanners "type" a whole code in well under half a second.
export function entryTimer() {
  let first = 0
  return {
    onChange(v) { if (!v) first = 0; else if (!first) first = performance.now() },
    wasScanner(v) { const fast = first && v.length >= 6 && performance.now() - first < 400; first = 0; return !!fast },
  }
}

// Does this lookup mean the cooler has no readable label? (Wanda: real labels start with "11")
//  matchedBy = which assets_live field matched; how = 'camera' | 'scanner' | 'typed'
export function labelNeed(asset, matchedBy, how) {
  if (!asset?.bar_code) return null
  const viaBarcode = matchedBy === 'bar_code' || (matchedBy === 'name' && how !== 'typed')
  if (viaBarcode && how !== 'typed') return null // the label scanned → it is there
  return asset.bar_code.startsWith('11') ? 'lost' : 'never_labelled'
}
export const REASON_LABEL = { never_labelled: 'Never labelled', lost: 'Label lost / unreadable', damaged: 'Damaged', wrong_label: 'Wrong label' }
