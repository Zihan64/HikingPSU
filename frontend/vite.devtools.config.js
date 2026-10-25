import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import {fileURLToPath} from 'node:url'

// Private artifact only. It is served by the authenticated gateway, never by
// Amplify's public frontend/dist release or an unauthenticated Vite dev server.
export default defineConfig(({command}) => {
  if (command !== 'build') throw new Error('Use the authenticated developer gateway; standalone dev serving is disabled')
  return {
    plugins:[react()],
    define:{
      'import.meta.env.VITE_DEVTOOLS':JSON.stringify('1'),
      'import.meta.env.VITE_API_BASE':JSON.stringify('/__badge_lab_api'),
      // The simulated *subject* uses the existing UI without contacting Auth0.
      // The real operator has already authenticated at the server-side gateway.
      'import.meta.env.VITE_AUTH0_DOMAIN':JSON.stringify('simulation.invalid'),
      'import.meta.env.VITE_AUTH0_CLIENT_ID':JSON.stringify('synthetic-test-subject'),
      'import.meta.env.VITE_AUTH0_AUDIENCE':JSON.stringify('urn:simulation-subject'),
    },
    build:{outDir:'.devtools-dist',emptyOutDir:true,
      rollupOptions:{input:fileURLToPath(new URL('./dev/badge-lab.html',import.meta.url))}},
  }
})
