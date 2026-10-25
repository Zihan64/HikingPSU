import React, {useCallback, useEffect, useMemo, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Auth0Context, initialContext} from '@auth0/auth0-react'
import App from '../src/App'
import {createSimulatedLocation, SCENARIOS} from './simulatedLocation'
import 'leaflet/dist/leaflet.css'
import '../src/index.css'
import './badge-lab.css'

if (!import.meta.env.DEV || import.meta.env.VITE_BADGE_LAB !== '1'
    || !['localhost','127.0.0.1'].includes(location.hostname)) {
  throw new Error('Badge Lab only runs through the separate local development launcher.')
}

const BASE = '/__badge_lab_api'
const originalNow = Date.now
const originalGeo = Object.getOwnPropertyDescriptor(navigator,'geolocation')
const originalPermissions = Object.getOwnPropertyDescriptor(navigator,'permissions')
const realNow = Date.now.bind(Date)
let offset = 0
Date.now = () => realNow() + offset
const simulation = createSimulatedLocation()
Object.defineProperty(navigator,'geolocation',{configurable:true,value:simulation.geolocation})
Object.defineProperty(navigator,'permissions',{configurable:true,value:simulation.permissions})
document.body.classList.add('badge-lab-active')

async function bootstrap() {
  const response = await fetch(`${BASE}/__lab/session`,{cache:'no-store'})
  if (!response.ok) throw new Error('本地测试后端尚未就绪，请确认 start-badge-lab.ps1 正在运行，再刷新页面。')
  return response.json()
}

function Lab({session,trails}) {
  const [trailId,setTrailId] = useState('mt-nittany-mike-lynch')
  const [scenario,setScenario] = useState('entrance'), [state,setState] = useState(session)
  const [version,setVersion] = useState(0), [view,setView] = useState('catalog')
  const [busy,setBusy] = useState(false), [error,setError] = useState(null)
  const trail = trails.find(t => t.id === trailId) || trails[0]
  const sync = useCallback(next => {
    offset = next.offset_ms;setState(next)
    // Real CheckinControl/ReviewModal refresh their clock; App reloads the active check-in.
    document.dispatchEvent(new Event('visibilitychange'))
  },[])
  const request = useCallback(async (path,body) => {
    const response = await fetch(`${BASE}${path}`,{method:body === undefined ? 'GET':'POST',cache:'no-store',
      headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},
      body:body === undefined ? undefined:JSON.stringify(body)})
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail:'测试请求失败')
    return data
  },[session.token])
  useEffect(() => {simulation.configure(trail,scenario)},[trail,scenario])
  useEffect(() => {
    offset = session.offset_ms
    const refresh = () => request('/__lab/state').then(setState).catch(() => {})
    const timer = setInterval(refresh,3000)
    return () => clearInterval(timer)
  },[request,session.offset_ms])
  async function run(path,body = {}) {
    setBusy(true);setError(null)
    try {sync(await request(path,body));return true}
    catch (err) {setError(err.message);return false}
    finally {setBusy(false)}
  }
  async function reset() {
    if (await run('/__lab/reset')) {setScenario('entrance');setVersion(v => v+1)}
  }
  function open(nextView = 'catalog') {setView(nextView);setVersion(v => v+1)}
  const account = useMemo(() => ({...initialContext,isLoading:false,isAuthenticated:true,
    user:{sub:session.user_id,name:'Badge Lab Tester',email:'tester@example.invalid'},
    getAccessTokenSilently:async () => session.token,
    loginWithPopup:async () => {},loginWithRedirect:async () => {},
    logout:() => setError('当前是独立测试账号。请使用“重置测试成就”，或关闭这个页面。'),
  }),[session.token,session.user_id])
  return <>
    <div className="badge-lab-banner">开发模拟环境 · 测试定位／测试账号／内存数据库 · 不会写入正式成就</div>
    <Auth0Context.Provider value={account}><App key={version} initialView={view} initialTrailId={trail.id} /></Auth0Context.Provider>
    <details className="badge-lab-panel" open>
      <summary>🧪 徽章测试面板（可收起）</summary>
      <div className="badge-lab-controls">
        <label>测试路线<select value={trail.id} onChange={e => {setTrailId(e.target.value);setScenario('entrance')}}>{trails.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>模拟定位<select value={scenario} onChange={e => setScenario(e.target.value)}>{SCENARIOS.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <p>入口：{trail.trailhead.lat}, {trail.trailhead.lon} · {scenario === 'coarse' ? '250':'15'} m 精度</p>
        <div className="badge-lab-buttons"><button onClick={() => open()}>打开这条路线</button><button onClick={() => open('profile')}>查看徽章墙</button></div>
        <p>先点击网页中的 <b>Start hike · check in</b>，再快进时间，最后点击 <b>Finish & rate</b>。</p>
        <div className="badge-lab-buttons"><button disabled={busy || !state.active} onClick={() => run('/__lab/ready')}>快进到可完成时间</button><button disabled={busy} onClick={() => run('/__lab/advance',{minutes:1})}>+1 分钟</button><button disabled={busy} onClick={() => run('/__lab/advance',{minutes:1440})}>+1 天</button><button disabled={busy} onClick={() => run('/__lab/advance',{minutes:1500})}>+25 小时（过期）</button></div>
        <dl><dt>测试时间</dt><dd>{new Date(realNow()+offset).toLocaleString()}</dd><dt>当前签到</dt><dd>{state.active?.trail_name || '无'}</dd><dt>完成 / 徽章</dt><dd>{state.completed} / {state.badges}</dd></dl>
        <button className="badge-lab-reset" disabled={busy} onClick={reset}>重置测试成就与时间</button>
        <p>每日 2 次、入口 200 m、精度 ≤100 m 等规则照常校验。精度不足场景会加速返回定位失败；不会等待 45 秒。</p>
        {error && <p role="alert" className="badge-lab-error">{error}</p>}
      </div>
    </details>
  </>
}

const root = createRoot(document.getElementById('root'))
if (import.meta.hot) import.meta.hot.dispose(() => {
  root.unmount();simulation.dispose();Date.now = originalNow
  if (originalGeo) Object.defineProperty(navigator,'geolocation',originalGeo)
  else delete navigator.geolocation
  if (originalPermissions) Object.defineProperty(navigator,'permissions',originalPermissions)
  else delete navigator.permissions
  document.body.classList.remove('badge-lab-active')
})
Promise.all([bootstrap(),fetch(`${BASE}/trails`).then(response => {if (!response.ok) throw new Error('无法加载测试路线');return response.json()})])
  .then(([session,trails]) => {offset=session.offset_ms;simulation.configure(trails.find(t => t.id === 'mt-nittany-mike-lynch') || trails[0]);root.render(<Lab session={session} trails={trails} />)})
  .catch(error => root.render(<main style={{padding:32}}><h1>徽章测试面板尚未就绪</h1><p>{error.message}</p></main>))
