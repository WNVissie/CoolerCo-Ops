import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { printLabel, printLabelDirect, isIphone, REASON_LABEL } from '../lib/labels'

// After a scan where the label actually read: confirm a printed label, and note that a "not 11" cooler is labelled.
// Quiet (never blocks the scan); does nothing without script 023 or without signal.
export function labelAfterScan(asset) {
  if (!asset?.name || !navigator.onLine) return
  const now = new Date().toISOString()
  supabase.from('coolerco_asset_labels').update({ status: 'confirmed', confirmed_at: now, updated_at: now })
    .eq('asset', asset.name).eq('status', 'printed').select('asset')
    .then(({ data, error }) => {
      if (error || data?.length) return
      if (asset.bar_code && !asset.bar_code.startsWith('11')) supabase.rpc('coolerco_label_mark', { p_assets: [asset.name], p_action: 'confirmed' }).then(() => {}, () => {})
    }, () => {})
}

// 🏷 "This cooler needs a label" — Print (Brother app / download) · Later (goes on the To label list)
export default function LabelPrompt({ asset, reason, dark = false }) {
  const [state, setState] = useState(null) // printing | printed | later | error
  const [note, setNote] = useState('')
  if (!asset || !reason) return null
  const mark = action => navigator.onLine
    ? supabase.rpc('coolerco_label_mark', { p_assets: [asset.name], p_action: action, p_reason: reason }).then(({ error }) => error && setNote('Not recorded: ' + error.message))
    : setNote('📵 No signal — not recorded; it shows on the To label list later only if flagged again.')
  const print = async (direct) => {
    setState('printing')
    try {
      const how = direct ? await printLabelDirect(asset) : await printLabel(asset)
      if (how === 'cancelled') { setState(null); return }
      await mark('printed'); setState('printed')
    } catch (e) { setState('error'); setNote(String(e.message || e)) }
  }
  if (state === 'printed') return <div className={`label-prompt done${dark ? ' dark' : ''}`}>🏷 Label sent to print — stick it on and <b>scan it once</b> to confirm.{note && <div className="text3">{note}</div>}</div>
  if (state === 'later') return <div className={`label-prompt done${dark ? ' dark' : ''}`}>🏷 Added to the <b>To label</b> list.{note && <div className="text3">{note}</div>}</div>
  return (
    <div className={`label-prompt${dark ? ' dark' : ''}`}>
      <div>🏷 <b>No readable label</b> · {REASON_LABEL[reason]} — print <span className="mono">{asset.bar_code}</span>?</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
        {!isIphone() && <button type="button" className="btn btn-primary btn-sm" disabled={state === 'printing'} onClick={() => print(true)} title="Opens the print window — choose the Brother P-touch">{state === 'printing' ? 'Printing…' : '🖨 Print to printer'}</button>}
        <button type="button" className={`btn btn-sm ${isIphone() ? 'btn-primary' : 'btn-ghost'}`} disabled={state === 'printing'} onClick={() => print(false)} title="Send the label image to the Brother app (iPrint&Label / Design&Print)">📲 Brother app</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { mark('needed'); setState('later') }}>Later</button>
        <a className="btn btn-ghost btn-sm" href={`/wms/labels?tab=fix&asset=${encodeURIComponent(asset.name)}`}>❌ Wrong cooler?</a>
      </div>
      {note && <div className="text3" style={{ fontSize: 10.5 }}>{note}</div>}
    </div>
  )
}
