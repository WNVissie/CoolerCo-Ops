import { useState, useEffect } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { PortalCatalogue } from './Setup'

// Admin → Catalogue: the families customers can request on the portal
export default function Catalogue() {
  const [user, setUser] = useState(null)
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUser(data.user)) }, [])
  return (
    <>
      <Topbar title="Catalogue" sub="What customers can request on the portal · families only, never stock levels" />
      <div className="page-content"><PortalCatalogue by={user?.email} /></div>
    </>
  )
}
