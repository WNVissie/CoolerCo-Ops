import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import Topbar from '../../components/Topbar'
import CameraScan, { codeCandidates } from '../../components/CameraScan'
import { supabase } from '../../lib/supabase'
import { fmt, num, BAYS } from '../../lib/helpers'
import { printLabel, printLabelDirect, isIphone, ptouchCsv, REASON_LABEL } from '../../lib/labels'

// 🏷 Asset labels (script 023). The COM barcode is re-printed (QR + number) on the Brother P-touch, 24 mm tape.
//  To label  : RTMA stock with no physical label (barcode not starting "11", or flagged lost at a scan), sorted for a walk
//              through the warehouse → 🖨 one label (phone → Brother app) or ⬇ P-touch file for a batch → scan to confirm
//  Corrections: the label on the cooler belongs to another asset → list to fix in COM (Excel)
const PAGE = 150
const needsScript = e => (/does not exist|Could not find/i.test(e?.message || '') ? 'This page needs database script 023 — not applied on this database yet.' : e?.message)
const bayOf = k => BAYS.find(b => b.key === k)

export default function Labels() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'fix' ? 'fix' : 'todo'
  const [summary, setSummary] = useState(null)
  const [wh, setWh] = useState(() => localStorage.getItem('cc_label_wh') || '')
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all') // all | needed | printed
  const [sel, setSel] = useState(() => new Set())
  const [shown, setShown] = useState(PAGE)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => { supabase.rpc('coolerco_label_summary').then(({ data, error }) => { if (error) setErr(needsScript(error)); setSummary(data || []) }) }, [tick])
  useEffect(() => {
    if (tab !== 'todo') return
    let live = true
    setRows(null); setSel(new Set()); setShown(PAGE)
    supabase.rpc('coolerco_label_todo', { p_warehouse: wh || null }).then(({ data, error }) => { if (!live) return; if (error) setErr(needsScript(error)); setRows(data || []) })
    return () => { live = false }
  }, [wh, tab, tick])
  const pickWh = w => { const v = wh === w ? '' : w; setWh(v); try { localStorage.setItem('cc_label_wh', v) } catch { /* private mode */ } }

  const s = q.trim().toLowerCase()
  const list = useMemo(() => (rows || []).filter(r => (status === 'all' || r.status === status)
    && (!s || [r.bar_code, r.local_code, r.asset, r.product_variant, r.product_base, r.last_area].some(v => String(v || '').toLowerCase().includes(s)))), [rows, status, s])
  const chosen = sel.size ? list.filter(r => sel.has(r.asset)) : list
  const tot = (summary || []).reduce((t, r) => ({ stock: t.stock + +r.stock, to: t.to + +r.to_label, pr: t.pr + +r.printed, ok: t.ok + +r.confirmed, fix: t.fix + +r.corrections_open }), { stock: 0, to: 0, pr: 0, ok: 0, fix: 0 })

  const toggle = a => setSel(x => { const n = new Set(x); n.has(a) ? n.delete(a) : n.add(a); return n })
  const markPrinted = async items => {
    const { error } = await supabase.rpc('coolerco_label_mark', { p_assets: items.map(r => r.asset), p_action: 'printed' })
    if (error) { setMsg({ bad: true, t: error.message }); return false }
    return true
  }
  async function printOne(r, direct = !isIphone()) {
    const how = direct ? await printLabelDirect(r) : await printLabel(r)
    if (how !== 'cancelled' && await markPrinted([r])) { setMsg({ t: `🖨 ${r.bar_code} sent to print — scan it once it is on the cooler.` }); setTick(t => t + 1) }
  }
  async function batchPrint() {
    if (!chosen.length) return
    if (chosen.length > 50 && !confirm(`Print ${chosen.length} labels in one go?`)) return
    await printLabelDirect(chosen)
    if (confirm(`Did the ${chosen.length} labels print? Mark them as printed?\n(Then scan each one after sticking it on.)`)) {
      if (await markPrinted(chosen)) { setMsg({ t: `✓ ${chosen.length} marked as printed.` }); setTick(t => t + 1) }
    }
  }
  async function batchFile() {
    if (!chosen.length) return
    ptouchCsv(chosen, `PTouch_labels_${wh || 'ALL'}_${new Date().toLocaleDateString('en-CA')}.csv`)
    if (confirm(`Mark these ${chosen.length} labels as printed?\n(Then scan each one after sticking it on to confirm.)`)) {
      if (await markPrinted(chosen)) { setMsg({ t: `✓ ${chosen.length} marked as printed.` }); setTick(t => t + 1) }
    }
  }

  return (
    <>
      <Topbar title="Asset labels" sub="Re-print the COM barcode · QR + number · Brother P-touch 24 mm"
        actions={<button className="btn btn-ghost btn-sm" onClick={() => setTick(t => t + 1)}>↻ Refresh</button>} />
      <div className="page-content">
        {err && <div className="form-msg error">{err}</div>}

        <div className="stats-row">
          <button type="button" className="stat-card c-orange" style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', outline: tab === 'todo' ? '2px solid var(--accent)' : 'none' }} onClick={() => setParams({})}>
            <div className="stat-label">🏷 To label</div><div className="stat-value">{summary ? num(tot.to) : '…'}</div>
            <div className="stat-sub">no label on the cooler · {num(tot.pr)} printed, waiting for the confirming scan</div>
          </button>
          <div className="stat-card c-green">
            <div className="stat-label">✅ Labelled (confirmed)</div><div className="stat-value">{summary ? num(tot.ok) : '…'}</div>
            <div className="stat-sub">printed, stuck on and scanned</div>
          </div>
          <button type="button" className="stat-card c-red" style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', outline: tab === 'fix' ? '2px solid var(--accent)' : 'none' }} onClick={() => setParams({ tab: 'fix' })}>
            <div className="stat-label">🔁 Label corrections</div><div className="stat-value">{summary ? num(tot.fix) : '…'}</div>
            <div className="stat-sub">label belongs to another asset · fix in COM</div>
          </button>
        </div>

        {tab === 'todo' ? (<>
          <div className="wh-cards" role="group" aria-label="Labels to print per warehouse">
            <button type="button" className={`wh-card${!wh ? ' on' : ''}`} onClick={() => pickWh('')}>
              <span className="wh-card-n">{summary ? num(tot.to + tot.pr) : '…'}</span><span className="wh-card-l">All warehouses</span>
            </button>
            {(summary || []).map(r => (
              <button type="button" key={r.warehouse} className={`wh-card${wh === r.warehouse ? ' on' : ''}`} aria-pressed={wh === r.warehouse} onClick={() => pickWh(r.warehouse)}
                title={`${num(r.stock)} in stock · ${num(r.not_11)} never labelled · ${num(r.confirmed)} confirmed`}>
                <span className="wh-card-n">{num(+r.to_label + +r.printed)}</span><span className="wh-card-l">{r.warehouse}</span>
              </button>
            ))}
          </div>

          <ConfirmScan onDone={() => setTick(t => t + 1)} />

          {msg && <div className={`form-msg ${msg.bad ? 'error' : 'success'}`}>{msg.t}</div>}
          <div className="card">
            <div className="card-header" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="card-title">🏷 To label {wh && `· ${wh}`}</span>
              <span className="card-count">{num(list.length)}</span>
              <div className="seg" style={{ marginLeft: 8 }}>
                {[['all', 'All'], ['needed', 'To print'], ['printed', 'Printed · scan it']].map(([k, l]) =>
                  <button type="button" key={k} className={`seg-btn${status === k ? ' on' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}
              </div>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {!isIphone() && <button className="btn btn-primary btn-sm" disabled={!chosen.length} onClick={batchPrint} title="All chosen labels to the printer in one print job">🖨 Print {num(chosen.length)}</button>}
                <button className="btn btn-ghost btn-sm" disabled={!chosen.length} onClick={batchFile} title="CSV for P-touch Editor (PC) — link it to your QR + text template">⬇ P-touch file ({num(chosen.length)})</button>
              </span>
            </div>
            <div style={{ padding: '6px 12px' }}>
              <div className="search-wrap"><span className="ico">🔍</span>
                <input placeholder="Barcode, local code, model, area…" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} /></div>
            </div>
            {!rows ? <div className="load-state"><span className="spinner" /> Loading…</div> : !list.length ? (
              <div className="empty-state"><div className="empty-ico">🎉</div><div>Nothing to label{s ? ' for this search' : ''}.</div></div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr>
                    <th style={{ width: 28 }}><input type="checkbox" aria-label="Select all shown" checked={sel.size > 0 && list.every(r => sel.has(r.asset))}
                      onChange={e => setSel(e.target.checked ? new Set(list.map(r => r.asset)) : new Set())} /></th>
                    <th>Barcode</th><th>Model</th><th>Where</th><th>Why</th><th></th>
                  </tr></thead>
                  <tbody>{list.slice(0, shown).map(r => {
                    const b = bayOf(r.bay)
                    return (
                      <tr key={r.asset}>
                        <td><input type="checkbox" aria-label={`Select ${r.bar_code}`} checked={sel.has(r.asset)} onChange={() => toggle(r.asset)} /></td>
                        <td style={{ fontSize: 11 }}><b className="mono">{r.bar_code}</b><div className="text3 mono" style={{ fontSize: 10 }}>Local {r.local_code || '—'}</div></td>
                        <td style={{ fontSize: 11 }}>{r.product_variant || r.product_base}<div className="text3" style={{ fontSize: 10 }}>{r.condition}</div></td>
                        <td style={{ fontSize: 11 }}>{r.warehouse} {r.ws ? 'WS' : 'WH'} · {b ? `${b.icon} ${b.label}` : r.asset_status}
                          <div className="text3" style={{ fontSize: 10 }}>{r.last_area ? `last scanned in ${r.last_area}` : 'not scanned by CoolerCo yet'}</div></td>
                        <td style={{ fontSize: 11 }}>{REASON_LABEL[r.reason] || r.reason}
                          {r.status === 'printed' && <div><span className="tag tag-blue">🖨 printed {fmt(r.printed_at)} · scan it</span></div>}</td>
                        <td><span style={{ display: 'flex', gap: 4 }}>{!isIphone() && <button className="btn btn-ghost btn-sm" onClick={() => printOne(r, true)} title="Print window → choose the P-touch">🖨 Print</button>}
                          <button className="btn btn-ghost btn-sm" onClick={() => printOne(r, false)} title="Send to the Brother app (phone) / download the image (PC)">📲</button></span></td>
                      </tr>)
                  })}</tbody>
                </table>
              </div>
            )}
            {list.length > shown && <div style={{ padding: 10, textAlign: 'center' }}><button className="btn btn-ghost btn-sm" onClick={() => setShown(n => n + PAGE * 3)}>Show more ({num(list.length - shown)} left)</button></div>}
          </div>
          <details className="sec" style={{ marginTop: 10 }}>
            <summary>ℹ️ How to print</summary>
            <div className="sec-body" style={{ fontSize: 11.5 }}>
              <p><b>🖨 Print to printer (PC or Android):</b> opens the print window with a 24 mm label page → choose the P-touch → Print. The browser remembers the printer. PC: the Brother P-touch driver must be installed. Android: install Brother&rsquo;s free <i>Brother Print Service Plugin</i> (Play Store) once, so the P-touch shows in the list. Tick several coolers and use <b>🖨 Print n</b> to print them in one go.</p>
              <p><b>📲 Brother app (iPhone, or if the print window doesn&rsquo;t show the P-touch):</b> Share → iPrint&amp;Label / Design&amp;Print → print. On a PC this downloads the image.</p>
              <p><b>A batch (PC):</b> tick the coolers (or none = everything shown) → ⬇ P-touch file → in P-touch Editor open your label template (a QR code linked to the <i>Barcode</i> column + the <i>Barcode</i> number in large text; optional <i>LocalCode</i> / <i>Model</i>) → File → Database → Connect → choose the file → print all. The list is in walking order: warehouse, area, bay.</p>
              <p><b>Confirm:</b> stick the label on, then scan it — here (Confirm box above) or with any normal scan. Only then does the cooler count as labelled.</p>
              <p>Rule: real labels start with <b>11</b>; other barcodes were never physically labelled. A cooler found by typing its local code also asks for a label.</p>
            </div>
          </details>
        </>) : <Corrections initialAsset={params.get('asset')} onChanged={() => setTick(t => t + 1)} />}
      </div>
    </>
  )
}

// ✅ Scan a freshly stuck-on label → confirmed (camera or hand scanner / typed)
function ConfirmScan({ onDone }) {
  const [code, setCode] = useState('')
  const [cam, setCam] = useState(false)
  const [last, setLast] = useState(null)
  const ref = useRef(null)
  async function confirmCode(raw) {
    const keys = codeCandidates(String(raw || '').trim()).filter(Boolean)
    if (!keys.length) return
    setCode('')
    const now = new Date().toISOString()
    const { data, error } = await supabase.from('coolerco_asset_labels').update({ status: 'confirmed', confirmed_at: now, updated_at: now })
      .in('bar_code', keys).in('status', ['printed', 'needed']).select('asset,bar_code')
    if (error) { setLast({ bad: true, t: error.message }); return }
    if (data?.length) { navigator.vibrate?.(60); setLast({ t: `✅ ${data[0].bar_code} confirmed — label is on and scans.` }); onDone?.() }
    else { navigator.vibrate?.([80, 60, 80]); setLast({ bad: true, t: `“${keys[0]}” is not waiting for a label (already confirmed, or not printed from here).` }) }
    ref.current?.focus()
  }
  return (
    <div className="card" style={{ padding: 10, marginBottom: 10 }}>
      <form className="scan-find" onSubmit={e => { e.preventDefault(); confirmCode(code) }} style={{ marginBottom: 0 }}>
        <button type="button" className="btn btn-primary scan-cam-btn" onClick={() => setCam(true)}>📷 Confirm</button>
        <div className="search-wrap"><span className="ico">✅</span>
          <input ref={ref} enterKeyHint="done" autoComplete="off" placeholder="Scan a label you just stuck on" value={code} onChange={e => setCode(e.target.value)} /></div>
      </form>
      {last && <div className={`form-msg ${last.bad ? 'error' : 'success'}`}>{last.t}</div>}
      {cam && <CameraScan continuous onClose={() => setCam(false)} onResult={confirmCode}>
        {last && <div className={`label-prompt dark${last.bad ? '' : ' done'}`}>{last.t}</div>}
      </CameraScan>}
    </div>
  )
}

// 🔁 Label corrections: the code on the cooler belongs to another asset in COM
function Corrections({ initialAsset, onChanged }) {
  const [rows, setRows] = useState(null)
  const [show, setShow] = useState('open')
  const [codeOn, setCodeOn] = useState('')
  const [trueKey, setTrueKey] = useState(initialAsset || '')
  const [found, setFound] = useState(null) // { onCode, truth }
  const [notes, setNotes] = useState('')
  const [msg, setMsg] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let qy = supabase.from('coolerco_label_corrections').select('*').order('found_at', { ascending: false }).limit(500)
    if (show !== 'all') qy = qy.eq('status', show)
    qy.then(({ data }) => setRows(data || []))
  }, [show, tick])

  const ASSET_COLS = 'name,bar_code,local_code,serial_number,sap_number,product_variant,product_base,assign_account,asset_location,points_of_sale'
  const findOne = async key => {
    const k = String(key || '').trim().replace(/[,()"\\]/g, '')
    if (!k) return null
    const { data } = await supabase.from('assets_live').select(ASSET_COLS)
      .or(['name', 'bar_code', 'local_code', 'serial_number', 'sap_number', 'external_code'].map(f => `${f}.eq.${k}`).join(',')).limit(3)
    return data?.[0] || null
  }
  async function check(e) {
    e?.preventDefault()
    setMsg(null)
    const [onCode, truth] = await Promise.all([findOne(codeOn), findOne(trueKey)])
    if (!truth) { setFound(null); setMsg({ bad: true, t: 'The real cooler was not found — try its local code, serial or SAP no.' }); return }
    if (onCode && onCode.name === truth.name) { setFound(null); setMsg({ bad: true, t: 'Both point to the same asset — the label is right.' }); return }
    setFound({ onCode, truth })
  }
  async function save() {
    const { onCode, truth } = found
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('coolerco_label_corrections').insert({
      code_on_cooler: codeOn.trim(), asset_of_code: onCode?.name || null, asset_true: truth.name, true_bar_code: truth.bar_code,
      warehouse: truth.assign_account, notes: notes.trim() || null, found_by: u?.user?.email || null,
    })
    if (error) { setMsg({ bad: true, t: error.message }); return }
    await supabase.rpc('coolerco_label_mark', { p_assets: [truth.name], p_action: 'needed', p_reason: 'wrong_label' })
    setMsg({ t: `Saved. Remove the old label and print ${truth.bar_code} for this cooler.`, print: truth })
    setFound(null); setCodeOn(''); setTrueKey(''); setNotes(''); setTick(t => t + 1); onChanged?.()
  }
  async function printTruth(a) {
    const how = await printLabel(a)
    if (how !== 'cancelled') { await supabase.rpc('coolerco_label_mark', { p_assets: [a.name], p_action: 'printed', p_reason: 'wrong_label' }); setMsg({ t: `🖨 ${a.bar_code} sent to print — scan it once it is on.` }); onChanged?.() }
  }
  async function fixed(r) {
    const { data: u } = await supabase.auth.getUser()
    await supabase.from('coolerco_label_corrections').update({ status: 'fixed', fixed_at: new Date().toISOString(), fixed_by: u?.user?.email || null }).eq('id', r.id)
    setTick(t => t + 1); onChanged?.()
  }
  async function exportXlsx() {
    const XLSX = await import('xlsx')
    const data = (rows || []).map(r => ({ 'Code on the cooler': r.code_on_cooler, 'COM links that code to': r.asset_of_code, 'Real asset': r.asset_true,
      'Real barcode': r.true_bar_code, Warehouse: r.warehouse, Notes: r.notes, Found: fmt(r.found_at), 'Found by': r.found_by, Status: r.status, 'Fixed in COM': fmt(r.fixed_at), 'Fixed by': r.fixed_by }))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Label corrections')
    XLSX.writeFile(wb, `CoolerCo_Label_corrections_${show}_${new Date().toLocaleDateString('en-CA')}.xlsx`)
  }
  const place = a => a ? (a.assign_account || a.points_of_sale || a.asset_location || '—') : '—'

  return (<>
    <form className="card" style={{ padding: 12, marginBottom: 10 }} onSubmit={check}>
      <div className="card-title" style={{ marginBottom: 8 }}>🔁 Report a wrong label</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}><div className="field-lbl">Code on the cooler (old label / plate)</div>
          <input className="field-ctrl" style={{ width: '100%' }} value={codeOn} onChange={e => setCodeOn(e.target.value)} placeholder="e.g. 6068203" /></div>
        <div style={{ flex: 1, minWidth: 180 }}><div className="field-lbl">The real cooler — local code, serial or SAP no.</div>
          <input className="field-ctrl" style={{ width: '100%' }} value={trueKey} onChange={e => setTrueKey(e.target.value)} placeholder="what is on its data plate" /></div>
        <div style={{ alignSelf: 'flex-end' }}><button className="btn btn-primary btn-sm" disabled={!codeOn.trim() || !trueKey.trim()}>Check</button></div>
      </div>
      {found && (
        <div className="req-box" style={{ marginTop: 10 }}>
          <div className="dl-grid">
            <div className="dl-field"><div className="lbl">COM links “{codeOn}” to</div><div className="val mono">{found.onCode ? `${found.onCode.bar_code} · ${found.onCode.product_variant || found.onCode.product_base}` : 'nothing (unknown code)'}</div><div className="text3" style={{ fontSize: 10.5 }}>{place(found.onCode)}</div></div>
            <div className="dl-field"><div className="lbl">This cooler really is</div><div className="val mono">{found.truth.bar_code} · {found.truth.product_variant || found.truth.product_base}</div><div className="text3" style={{ fontSize: 10.5 }}>Local {found.truth.local_code} · {place(found.truth)}</div></div>
          </div>
          <textarea className="field-ctrl" rows={2} style={{ width: '100%', marginTop: 6 }} placeholder="Note (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="modal-btns"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setFound(null)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={save}>Save correction</button></div>
        </div>
      )}
      {msg && <div className={`form-msg ${msg.bad ? 'error' : 'success'}`}>{msg.t} {msg.print && <button type="button" className="btn btn-primary btn-sm" onClick={() => printTruth(msg.print)}>🖨 Print {msg.print.bar_code}</button>}</div>}
    </form>

    <div className="card">
      <div className="card-header" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="card-title">Label corrections</span><span className="card-count">{rows ? num(rows.length) : '…'}</span>
        <div className="seg" style={{ marginLeft: 8 }}>
          {[['open', 'To fix in COM'], ['fixed', 'Fixed'], ['all', 'All']].map(([k, l]) => <button type="button" key={k} className={`seg-btn${show === k ? ' on' : ''}`} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={!rows?.length} onClick={exportXlsx}>⬇ Excel</button>
      </div>
      {!rows ? <div className="load-state"><span className="spinner" /> Loading…</div> : !rows.length ? (
        <div className="empty-state"><div className="empty-ico">✅</div><div>No corrections {show === 'open' ? 'waiting' : 'here'}.</div></div>
      ) : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Code on cooler</th><th>COM links it to</th><th>Real cooler</th><th>Found</th><th></th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td className="mono" style={{ fontSize: 11 }}>{r.code_on_cooler}</td>
              <td className="mono" style={{ fontSize: 11 }}>{r.asset_of_code || '—'}</td>
              <td style={{ fontSize: 11 }}><b className="mono">{r.true_bar_code}</b><div className="text3 mono" style={{ fontSize: 10 }}>{r.asset_true}</div>{r.notes && <div className="text3" style={{ fontSize: 10 }}>{r.notes}</div>}</td>
              <td style={{ fontSize: 11 }}>{fmt(r.found_at)}<div className="text3" style={{ fontSize: 10 }}>{r.found_by}{r.warehouse ? ` · ${String(r.warehouse).replace(/^RTMA /, '')}` : ''}</div></td>
              <td>{r.status === 'open' ? <button className="btn btn-ghost btn-sm" onClick={() => fixed(r)}>✓ Fixed in COM</button> : <span className="tag tag-green">fixed {fmt(r.fixed_at)}</span>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  </>)
}
