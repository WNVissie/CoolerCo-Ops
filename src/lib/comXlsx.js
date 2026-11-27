// Fill COM's own Excel import templates (Dynamics 365 "Download template" / exported views) in the browser.
// Why not SheetJS: its free version drops the Excel table (and the hidden metadata sheet keeps its place only by luck).
// COM's import reads the TABLE, so the table range must cover every data row. This edits the xlsx parts directly:
//   * the visible data sheet (the one holding the table) - rows rewritten, everything else kept (columns, validations)
//   * the table's ref + autoFilter ref, and the sheet's dimension
//   * styles.xml only when a date style has to be added
// The veryHidden "hiddenSheet" (entity + field mapping, e.g. noesis_casenotification) is never touched.
//   new mode    = new records (Case Notification, Case Repair): template rows are cleared, our rows written.
//   update mode = update records (Case update view): a fresh COM export; matching rows kept with their hidden
//                 "(Do Not Modify)" id + checksum, our columns overwritten, other rows dropped.
import JSZip from 'jszip'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
let XML = { DOMParser: globalThis.DOMParser, XMLSerializer: globalThis.XMLSerializer }
export const setXml = x => { XML = x }   // tests in Node pass @xmldom/xmldom

const parse = s => new XML.DOMParser().parseFromString(s.replace(/^\uFEFF/, ''), 'application/xml')
const serialize = d => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + new XML.XMLSerializer().serializeToString(d).replace(/^<\?xml[^>]*\?>\s*/, '')
const kids = (el, name) => Array.from(el.childNodes).filter(n => n.nodeType === 1 && n.localName === name)
const all = (el, name) => Array.from(el.getElementsByTagNameNS(NS, name))
const colLetter = i => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) } return s }
const colIndex = ref => { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }
const rowOf = ref => Number(/(\d+)$/.exec(ref)[1])
const resolve = (base, target) => {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p) }
  return parts.join('/')
}
const relsPath = p => { const i = p.lastIndexOf('/'); return `${p.slice(0, i)}/_rels/${p.slice(i + 1)}.rels` }
const qname = (doc, local) => (doc.documentElement.prefix ? `${doc.documentElement.prefix}:${local}` : local)
const mk = (doc, local) => doc.createElementNS(NS, qname(doc, local))

// Excel serial number for a moment, in South African wall-clock time (COM shows the times as typed)
export function excelSerial(d, timeZone = 'Africa/Johannesburg') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d instanceof Date ? d : new Date(d)).map(x => [x.type, x.value]))
  const ms = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return (ms - Date.UTC(1899, 11, 30)) / 864e5
}

export async function readTemplate(buf) {
  const zip = await JSZip.loadAsync(buf)
  const text = async p => { const f = zip.file(p); if (!f) throw new Error(`Template part missing: ${p}`); return f.async('string') }
  const wb = parse(await text('xl/workbook.xml'))
  const wbRels = parse(await text('xl/_rels/workbook.xml.rels'))
  const relTarget = (doc, id) => Array.from(doc.getElementsByTagNameNS(NS_PKG, 'Relationship')).find(r => r.getAttribute('Id') === id)?.getAttribute('Target')
  // the data sheet = the sheet that holds a table (COM's "hiddenSheet" never does)
  for (const sh of all(wb, 'sheet')) {
    const rid = sh.getAttributeNS(NS_R, 'id') || sh.getAttribute('r:id')
    const sheetPath = resolve('xl/workbook.xml', relTarget(wbRels, rid))
    const rp = relsPath(sheetPath)
    if (!zip.file(rp)) continue
    const sRels = parse(await text(rp))
    const rel = Array.from(sRels.getElementsByTagNameNS(NS_PKG, 'Relationship')).find(r => /\/table$/.test(r.getAttribute('Type')))
    if (!rel) continue
    const tablePath = resolve(sheetPath, rel.getAttribute('Target'))
    const sheet = parse(await text(sheetPath))
    const table = parse(await text(tablePath))
    const headers = all(table, 'tableColumn').map(c => c.getAttribute('name'))
    const colStyle = {}
    for (const c of all(sheet, 'col')) {
      const s = c.getAttribute('style'); if (s == null) continue
      for (let i = +c.getAttribute('min'); i <= +c.getAttribute('max'); i++) colStyle[i - 1] = s
    }
    const rows = all(sheet, 'row').filter(r => +r.getAttribute('r') > 1)
    return { zip, sheetPath, tablePath, sheet, table, headers, colStyle, sheetName: sh.getAttribute('name'), dataRows: rows.length,
             entity: await hiddenEntity(zip, wb, wbRels, relTarget) }
  }
  throw new Error('This file has no Excel table - use a template downloaded from COM (or a COM export of the view).')
}

// "noesis_casenotification" etc. from the hidden sheet, to warn when the wrong template is chosen
async function hiddenEntity(zip, wb, wbRels, relTarget) {
  try {
    const sh = all(wb, 'sheet').find(s => s.getAttribute('state') === 'veryHidden'); if (!sh) return null
    const p = resolve('xl/workbook.xml', relTarget(wbRels, sh.getAttributeNS(NS_R, 'id') || sh.getAttribute('r:id')))
    const s = await zip.file(p).async('string')
    return (/>([a-z_]+):[^<]*<\/(?:\w+:)?t>/.exec(s) || /<(?:\w+:)?t>([a-z_]+):/.exec(s) || [])[1] || null
  } catch { return null }
}

// a cellXfs index whose number format is "yyyy-mm-dd hh:mm" (added when the template has none)
async function dateStyle(tpl) {
  if (tpl._dateStyle != null) return tpl._dateStyle
  const p = 'xl/styles.xml'; const doc = parse(await tpl.zip.file(p).async('string'))
  const ss = doc.documentElement
  let fmts = kids(ss, 'numFmts')[0]
  let id = Array.from(fmts ? kids(fmts, 'numFmt') : []).find(f => f.getAttribute('formatCode') === 'yyyy-mm-dd hh:mm')?.getAttribute('numFmtId')
  if (!id) {
    if (!fmts) { fmts = mk(doc, 'numFmts'); ss.insertBefore(fmts, ss.firstChild) }
    id = String(Math.max(163, ...kids(fmts, 'numFmt').map(f => +f.getAttribute('numFmtId'))) + 1)
    const f = mk(doc, 'numFmt'); f.setAttribute('numFmtId', id); f.setAttribute('formatCode', 'yyyy-mm-dd hh:mm'); fmts.appendChild(f)
    fmts.setAttribute('count', String(kids(fmts, 'numFmt').length))
  }
  const xfs = kids(ss, 'cellXfs')[0]; const list = kids(xfs, 'xf')
  let idx = list.findIndex(x => x.getAttribute('numFmtId') === id)
  if (idx < 0) {
    const x = mk(doc, 'xf'); x.setAttribute('numFmtId', id); x.setAttribute('fontId', '0'); x.setAttribute('fillId', '0'); x.setAttribute('borderId', '0')
    x.setAttribute('xfId', '0'); x.setAttribute('applyNumberFormat', '1'); xfs.appendChild(x)
    xfs.setAttribute('count', String(list.length + 1)); idx = list.length
    tpl.zip.file(p, serialize(doc))
  }
  tpl._dateStyle = String(idx)
  return tpl._dateStyle
}

function cellNode(doc, ref, value, style) {
  const c = mk(doc, 'c'); c.setAttribute('r', ref)
  if (value instanceof Date) {
    c.setAttribute('s', style); c.setAttribute('t', 'n')
    const v = mk(doc, 'v'); v.textContent = String(excelSerial(value)); c.appendChild(v)
  } else if (typeof value === 'number' && isFinite(value)) {
    if (style) c.setAttribute('s', style)
    const v = mk(doc, 'v'); v.textContent = String(value); c.appendChild(v)
  } else {
    c.setAttribute('t', 'inlineStr')
    const is = mk(doc, 'is'); const t = mk(doc, 't'); t.textContent = String(value)
    if (/^\s|\s$/.test(t.textContent)) t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
    is.appendChild(t); c.appendChild(is)
  }
  return c
}
const empty = v => v == null || v === '' || (typeof v === 'number' && !isFinite(v))

function setRanges(tpl, lastRow) {
  const last = colLetter(tpl.headers.length - 1)
  const ref = `A1:${last}${Math.max(2, lastRow)}`
  tpl.table.documentElement.setAttribute('ref', ref)
  for (const a of all(tpl.table, 'autoFilter')) a.setAttribute('ref', ref)
  for (const d of all(tpl.sheet, 'dimension')) d.setAttribute('ref', ref)
  tpl.zip.file(tpl.sheetPath, serialize(tpl.sheet))
  tpl.zip.file(tpl.tablePath, serialize(tpl.table))
}

// rows = [{ 'Heading': value }] — headings must match the template's columns (unknown ones are reported, not written)
export async function fillNew(tpl, rows) {
  const unknown = new Set()
  const idx = Object.fromEntries(tpl.headers.map((h, i) => [h, i]))
  const needDate = rows.some(r => Object.values(r).some(v => v instanceof Date))
  const ds = needDate ? await dateStyle(tpl) : null
  const data = all(tpl.sheet, 'sheetData')[0]
  for (const r of all(tpl.sheet, 'row')) if (+r.getAttribute('r') > 1) r.parentNode.removeChild(r)
  rows.forEach((obj, n) => {
    const rn = n + 2
    const row = mk(tpl.sheet, 'row'); row.setAttribute('r', String(rn))
    Object.entries(obj).filter(([h, v]) => { if (idx[h] == null) { if (!empty(v)) unknown.add(h); return false } return !empty(v) })
      .sort((a, b) => idx[a[0]] - idx[b[0]])
      .forEach(([h, v]) => row.appendChild(cellNode(tpl.sheet, colLetter(idx[h]) + rn, v, v instanceof Date ? ds : tpl.colStyle[idx[h]])))
    data.appendChild(row)
  })
  setRanges(tpl, rows.length + 1)
  return { unknown: [...unknown] }
}

// keep only the rows whose key column is in `updates`, overwrite the given columns; returns which keys / columns were missing
export async function fillUpdate(tpl, keyHeading, updates) {
  const idx = Object.fromEntries(tpl.headers.map((h, i) => [h, i]))
  if (idx[keyHeading] == null) throw new Error(`The file has no "${keyHeading}" column.`)
  const shared = await sharedStrings(tpl.zip)
  const wanted = new Set(Object.values(updates).flatMap(o => Object.keys(o)))
  const missingCols = [...wanted].filter(h => idx[h] == null)
  const needDate = Object.values(updates).some(o => Object.entries(o).some(([h, v]) => v instanceof Date && idx[h] != null))
  const ds = needDate ? await dateStyle(tpl) : null
  const found = new Set()
  let rn = 1
  for (const row of all(tpl.sheet, 'row')) {
    if (+row.getAttribute('r') === 1) continue
    const cells = kids(row, 'c')
    const keyCell = cells.find(c => colIndex(c.getAttribute('r')) === idx[keyHeading])
    const key = keyCell ? cellText(keyCell, shared).trim() : ''
    const upd = updates[key]
    if (!upd || found.has(key)) { row.parentNode.removeChild(row); continue }
    found.add(key); rn += 1
    row.setAttribute('r', String(rn))
    for (const c of cells) c.setAttribute('r', colLetter(colIndex(c.getAttribute('r'))) + rn)
    for (const [h, v] of Object.entries(upd)) {
      if (idx[h] == null || empty(v)) continue
      const ref = colLetter(idx[h]) + rn
      const cur = kids(row, 'c')
      const same = cur.find(c => c.getAttribute('r') === ref)
      const nc = cellNode(tpl.sheet, ref, v, v instanceof Date ? ds : (same?.getAttribute('s') || tpl.colStyle[idx[h]]))
      if (same) row.replaceChild(nc, same)
      else row.insertBefore(nc, cur.find(c => colIndex(c.getAttribute('r')) > idx[h]) || null)
    }
  }
  setRanges(tpl, rn)
  return { found: [...found], missing: Object.keys(updates).filter(k => !found.has(k)), missingCols }
}

async function sharedStrings(zip) {
  const f = zip.file('xl/sharedStrings.xml'); if (!f) return []
  const d = parse(await f.async('string'))
  return all(d, 'si').map(si => all(si, 't').map(t => t.textContent).join(''))
}
function cellText(c, shared) {
  const t = c.getAttribute('t')
  if (t === 'inlineStr') return all(c, 't').map(x => x.textContent).join('')
  const v = all(c, 'v')[0]?.textContent ?? ''
  return t === 's' ? shared[+v] ?? '' : v
}

// list the key column values of a COM export (to check which cases it holds)
export async function keysOf(tpl, keyHeading) {
  const i = tpl.headers.indexOf(keyHeading); if (i < 0) return []
  const shared = await sharedStrings(tpl.zip)
  return all(tpl.sheet, 'row').filter(r => +r.getAttribute('r') > 1)
    .map(r => kids(r, 'c').find(c => colIndex(c.getAttribute('r')) === i)).filter(Boolean).map(c => cellText(c, shared).trim())
}

export async function toBlob(tpl, type = 'blob') {
  return tpl.zip.generateAsync({ type, compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
export const rowOfRef = rowOf
