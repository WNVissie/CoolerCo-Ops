import { lazy } from 'react'

// Like React.lazy, but if a page file is missing because a new version was
// deployed while the app was open, reload once to pick up the new version.
export function lazyPage(load) {
  return lazy(() => load().then(m => {
    try { sessionStorage.removeItem('cc_chunk_reload') } catch { /* ignore */ }
    return m
  }).catch(err => {
    let reloaded = false
    try { reloaded = sessionStorage.getItem('cc_chunk_reload') === '1' } catch { /* ignore */ }
    if (!reloaded) {
      try { sessionStorage.setItem('cc_chunk_reload', '1') } catch { /* ignore */ }
      window.location.reload()
      return new Promise(() => {}) // wait for the reload
    }
    throw err
  }))
}
