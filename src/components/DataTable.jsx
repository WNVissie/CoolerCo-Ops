import { PS } from '../lib/helpers'

export default function DataTable({ cols, rows, count, page, setPage, onRowClick, loading }) {
  const totalPages = Math.ceil((count || rows.length) / PS)
  const start = page * PS + 1
  const end = Math.min((page + 1) * PS, count || rows.length)

  if (loading) return (
    <div className="load-state"><span className="spinner" /> Loading…</div>
  )
  if (!rows.length) return (
    <div className="empty-state">
      <div className="empty-ico">🔍</div>
      <div>No results found</div>
    </div>
  )

  return (
    <>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>{cols.map(c => <th key={c.key}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} onClick={() => onRowClick?.(row)} style={onRowClick ? { cursor: 'pointer' } : {}}>
                {cols.map(c => (
                  <td key={c.key} className={c.cls || ''}>
                    {c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {count > PS && (
        <div className="pager">
          <span>{start}–{end} of {count?.toLocaleString()}</span>
          <div className="pager-btns">
            <button className="pager-btn" disabled={page === 0} onClick={() => setPage(0)}>«</button>
            <button className="pager-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button>
            <button className="pager-btn" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>›</button>
            <button className="pager-btn" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</button>
          </div>
        </div>
      )}
    </>
  )
}
