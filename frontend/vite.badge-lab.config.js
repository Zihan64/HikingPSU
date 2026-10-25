import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

// Separate local serve command. Neither the production entry nor normal Vite
// config imports the simulator. Ignore .env.local's production API/Auth0 values.
export default defineConfig(({command}) => {
  if (command !== 'serve') throw new Error('Badge Lab cannot be built or deployed')
  return {
    plugins:[react(), {name:'badge-lab-home', configureServer(server) {
      server.middlewares.use((req,res,next) => {
        if (req.url === '/') {res.writeHead(302,{Location:'/dev/badge-lab.html'});res.end();return}
        next()
      })
    }}],
    define:{
      'import.meta.env.VITE_BADGE_LAB':JSON.stringify('1'),
      'import.meta.env.VITE_API_BASE':JSON.stringify('/__badge_lab_api'),
      'import.meta.env.VITE_AUTH0_DOMAIN':JSON.stringify('badge-lab.invalid'),
      'import.meta.env.VITE_AUTH0_CLIENT_ID':JSON.stringify('local-simulator'),
      'import.meta.env.VITE_AUTH0_AUDIENCE':JSON.stringify('urn:badge-lab'),
    },
    server:{host:'127.0.0.1',port:5176,strictPort:true,cors:false,
      proxy:{'/__badge_lab_api':{target:'http://127.0.0.1:8010',rewrite:path => path.replace(/^\/__badge_lab_api/,'')}}},
  }
})
