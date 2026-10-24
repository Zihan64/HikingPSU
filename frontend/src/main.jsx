import React from 'react'
import ReactDOM from 'react-dom/client'
import { Auth0Provider } from '@auth0/auth0-react'
import App from './App'
import AuthGate from './AuthGate'
import { AUTH_ENABLED, AUTH0_AUDIENCE, AUTH0_CLIENT_ID, AUTH0_DOMAIN } from './auth'
import 'leaflet/dist/leaflet.css'
import './index.css'

const app = AUTH_ENABLED ? (
  <Auth0Provider
    domain={AUTH0_DOMAIN}
    clientId={AUTH0_CLIENT_ID}
    authorizationParams={{
      redirect_uri: window.location.origin,
      audience: AUTH0_AUDIENCE,
      scope: 'openid profile email',
    }}
    // Keep the session across page reloads (browsers block the cookie-based fallback).
    cacheLocation="localstorage"
  >
    <AuthGate>
      <App />
    </AuthGate>
  </Auth0Provider>
) : (
  <App />
)

ReactDOM.createRoot(document.getElementById('root')).render(app)
