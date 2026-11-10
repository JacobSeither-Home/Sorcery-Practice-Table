import { useState } from 'react';
import { useAuth } from '../cloud/cloud';

/** Shown in place of the app until someone on the access list is signed in. */
export function SignIn() {
  const a = useAuth();
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => { setBusy(true); await f(); setBusy(false); };
  return (
    <div className="gate">
      <div className="gatebox">
        <h1>Sorcery Practice Table</h1>
        <p className="lede">A private table for learning Sorcery: Contested Realm with friends.</p>
        {a.status === 'in' ? (<>
          <p>Signed in as <b>{a.email}</b>.</p>
          {a.unclaimed
            ? <><p>Nobody administers this table yet. The first account to claim it manages who else gets in.</p><div className="row"><button className="primary" disabled={busy} onClick={() => run(a.claim)}>Make me the administrator</button></div></>
            : <p>This address is not on the access list. The person who runs this table can add it in Settings.</p>}
          <div className="row"><button onClick={() => run(a.loadAccess)} disabled={busy}>Check again</button><button onClick={a.signOut}>Sign out</button></div>
        </>) : (
          <form onSubmit={(e) => { e.preventDefault(); run(() => a.signIn(email, pw)); }}>
            <label className="field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label className="field"><span>Password</span><input type="password" autoComplete="current-password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
            <div className="row"><button className="primary" type="submit" disabled={busy}>Sign in</button>
              <button type="button" disabled={busy || !email || pw.length < 8} onClick={() => run(() => a.signUp(email, pw))} data-tip="Uses the email and password above. Passwords need 8 characters.">Create account</button></div>
          </form>
        )}
        {a.note && <p className="banner" role="status">{a.note}</p>}
        <p className="note">Unofficial fan project, not affiliated with Erik's Curiosa. Free and non-commercial.</p>
      </div>
    </div>
  );
}
