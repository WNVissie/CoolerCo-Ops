import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Same Supabase accounts as SmartHub. Drivers / technicians without an email sign in with their username
// (e.g. rtmagtd2): the app adds the field domain the Crew screen used when it created the login.
export const FIELD_DOMAIN = 'field.smartpartners.co.za'
export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr(null)
    const id = email.trim().toLowerCase()
    const { error } = await supabase.auth.signInWithPassword({ email: id.includes('@') ? id : `${id}@${FIELD_DOMAIN}`, password })
    setBusy(false)
    if (error) setErr(error.message === 'Invalid login credentials' ? 'Email / username or password is incorrect.' : error.message)
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="logo-icon" style={{ margin: '0 auto 10px' }}>CC</div>
        <div className="card-title" style={{ textAlign: 'center' }}>CoolerCo-Ops</div>
        <div className="text3" style={{ textAlign: 'center', fontSize: 11, marginBottom: 16 }}>Sign in with your SmartHub account</div>
        <div className="field-lbl">✉️ Email or username</div>
        <input className="field-ctrl" type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
        <div className="field-lbl" style={{ marginTop: 10 }}>🔒 Password</div>
        <input className="field-ctrl" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        {err && <div className="form-msg err" style={{ marginTop: 10 }}>{err}</div>}
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}
