import { useState } from 'react'
import { supabase } from '../lib/supabase'

// 📷 Model photo for an asset, from the portal catalogue (Setup → Portal catalogue).
// Collapsed: nothing loads until the user opens it.
//   CoolerCo clients (Tiger, Demo …): asset → model → catalogue photo of that model
//   Magnum (COM): asset → product base → catalogue family photo
// Photos sit in the private 'coolerco-cases' bucket, so the link is signed for an hour.
export default function ModelPhoto({ asset }) {
  const [state, setState] = useState(null) // null = not loaded · { url, name } · { none: true }

  async function load() {
    if (state || !asset) return
    setState({ loading: true })
    let path = null, name = null
    const { data: cc } = await supabase.from('coolerco_assets').select('model_code').eq('asset_number', asset).maybeSingle()
    if (cc?.model_code) {
      const { data: m } = await supabase.from('coolerco_asset_models').select('photo_path,display_name,description').eq('model_code', cc.model_code).limit(1).maybeSingle()
      path = m?.photo_path; name = m?.display_name || m?.description || cc.model_code
    } else {
      const { data: a } = await supabase.from('assets_live').select('product_base').eq('name', asset).maybeSingle()
      if (a?.product_base) {
        const { data: bf } = await supabase.from('coolerco_product_base_family').select('family:coolerco_product_families(photo_path,display_name,name)').eq('product_base', a.product_base).limit(1).maybeSingle()
        path = bf?.family?.photo_path; name = bf?.family?.display_name || bf?.family?.name || a.product_base
      }
    }
    if (!path) { setState({ none: true, name }); return }
    const { data: s } = await supabase.storage.from('coolerco-cases').createSignedUrl(path, 3600)
    setState(s?.signedUrl ? { url: s.signedUrl, name } : { none: true, name })
  }

  if (!asset) return null
  return (
    <details className="model-photo" onToggle={e => e.currentTarget.open && load()} style={{ marginTop: 6 }}>
      <summary className="text3" style={{ fontSize: 11, cursor: 'pointer' }}>📷 Model photo</summary>
      <div style={{ paddingTop: 6 }}>
        {!state || state.loading ? <span className="spinner" />
          : state.url ? (
            <a href={state.url} target="_blank" rel="noopener noreferrer" title="Open the full photo">
              <img src={state.url} alt={state.name || 'Model photo'} style={{ maxWidth: 180, maxHeight: 180, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--border, #e3e7ee)', background: '#fff' }} />
              {state.name && <div className="text3" style={{ fontSize: 10.5 }}>{state.name}</div>}
            </a>
          ) : <div className="text3" style={{ fontSize: 11 }}>No catalogue photo{state.name ? ` for ${state.name}` : ''} yet. Add one under Setup → Portal catalogue.</div>}
      </div>
    </details>
  )
}
