import { useState } from 'react'
import guestAvatar from './assets/guest-avatar.png'

// All states share the same avatar, name and action slots, including guests.
export default function UserIdentity({ user, signedIn = false, loading = false, status, loginNotice, onLogin, onLogout, onProfile, profileActive = false }) {
  const [failedPicture, setFailedPicture] = useState(null)
  const name = loading ? 'Loading…' : signedIn ? user?.name?.trim() || user?.nickname || user?.email || 'Member' : 'Guest'
  const picture = signedIn && user?.picture && failedPicture !== user.picture ? user.picture : guestAvatar
  return <div className="account-control" aria-label="User account">
    <button type="button" className="account-identity" onClick={onProfile} disabled={!signedIn || !onProfile} aria-pressed={profileActive} aria-label={signedIn ? `My profile (${name})` : 'Guest account'}>
      <img className="account-avatar" src={picture} alt="" referrerPolicy="no-referrer" onError={() => setFailedPicture(user?.picture)} />
      <span className="account-name" title={name}>{name}</span>
      {status && <span className="account-status" role="status" aria-label={status} title={status}>!</span>}
    </button>
    <button className="account-action" disabled={loading || !(signedIn ? onLogout : onLogin)} onClick={signedIn ? onLogout : onLogin}>
      {signedIn ? 'Log out' : 'Log in'}
    </button>
    {loginNotice && <p className="account-notice" role="alert">{loginNotice}</p>}
  </div>
}
