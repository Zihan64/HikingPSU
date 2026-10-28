// Release guard: development-only packages must not enter the public artifact.
import {readdir,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

async function scan(directory) {
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name)
    if (entry.isDirectory()) {await scan(path);continue}
    if (/badge-lab\.html|devtools-build\.json/.test(entry.name)) throw new Error(`Private developer artifact in public build: ${path}`)
    if (!/\.(html|js|css|json)$/.test(entry.name)) continue
    const contents=await readFile(path,'utf8')
    if (/__badge_lab_api|Badge Lab Tester|createSimulatedLocation|hikingpsu_devtools_session/.test(contents)) {
      throw new Error(`Private developer module detected in public build: ${path}`)
    }
  }
}
await scan(fileURLToPath(new URL('../dist',import.meta.url)))
console.log('Public release verified: no private developer interface, identity or API base.')
