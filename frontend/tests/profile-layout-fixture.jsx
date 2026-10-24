// Development-only layout checks. These are synthetic profiles, not sign-ins.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import AppHeader from '../src/AppHeader'
import UserIdentity from '../src/UserIdentity'
import '../src/index.css'

if (!import.meta.env.DEV) throw new Error('Account fixture is only available during local development.')

function ProfileLayoutFixture() {
  const [mode, setMode] = useState('guest')
  const users = {short:{name:'Alex'}, long:{name:'A very long hiking profile name that must be shortened inside the fixed name slot'}}
  return <div className="app-shell">
    <AppHeader onHome={() => setMode('guest')} onLibrary={() => {}} libraryOpen={false}
      account={<UserIdentity user={users[mode]} signedIn={mode in users} loading={mode === 'loading'}
        status={mode === 'error' ? 'Sign-in failed. Please try again.' : null}
        onLogin={() => setMode('short')} onLogout={() => setMode('guest')} />} />
    <main><h1>SIMULATED ACCOUNTS · no sign-in</h1><label>Account example <select value={mode} onChange={e => setMode(e.target.value)}>
      <option value="guest">Guest</option><option value="short">Short name</option><option value="long">Long name</option><option value="loading">Loading</option><option value="error">Sign-in error</option>
    </select></label></main>
  </div>
}

createRoot(document.getElementById('root')).render(<ProfileLayoutFixture />)
