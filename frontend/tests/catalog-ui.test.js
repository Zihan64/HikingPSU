import test, {before, beforeEach, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import React from 'react'
import {create, act} from 'react-test-renderer'
import {build} from 'esbuild'

let Catalog, tree, globals, calls, geometryStatus, parkStatus, reviewed
const listNode = {scrollTop:0, scrollTo({top}) {this.scrollTop = top}, querySelector() {return {focus(){}}}}
const base = {area:'Boalsburg', distance_mi:2, elevation_gain_ft:100, loop:true,
  difficulty:{level:1, est_time_min:55, reasons:['100 ft of climbing']}, access:{drive_min:10},
  trailhead:{lat:40.8,lon:-77.8,address:'Test trailhead'}, features:['birds'], best_seasons:['fall'],
  cell_signal:'fair', notes:'', verified:false, car_free:false}
const trails = [{...base,id:'one',name:'Forest Loop',park_id:'forest',park_name:'Rothrock'},
  {...base,id:'two',name:'Lake Walk',park_id:'lake',park_name:'Lake Park'}]
const parks = [{id:'forest',name:'Rothrock',manager:'DCNR',trail_count:1,official_area_id:'rothrock'},
  {id:'lake',name:'Lake Park',manager:'DCNR',trail_count:1,official_area_id:null}]

before(async () => {
  const output = new URL('../node_modules/.cache/catalog-tests/component.mjs', import.meta.url)
  await mkdir(fileURLToPath(new URL('./',output)), {recursive:true})
  await build({entryPoints:[fileURLToPath(new URL('../src/TrailCatalog.jsx',import.meta.url))],
    outfile:fileURLToPath(output),bundle:true,platform:'node',format:'esm',jsx:'automatic',
    external:['react','react/jsx-runtime','@auth0/auth0-react'],define:{'import.meta.env':'{}'},
    plugins:[{name:'map-without-dom',setup(build) {
      build.onResolve({filter:/^\.\/TrailMap$/}, () => ({path:'map',namespace:'test-map'}))
      build.onLoad({filter:/.*/,namespace:'test-map'}, () => ({contents:'export default function Map(){return null}',loader:'js'}))
    }}]})
  Catalog = (await import(output.href)).default
})
beforeEach(() => {
  globals = {fetch:globalThis.fetch,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame}
  calls = []; geometryStatus = 404; parkStatus = 200; reviewed = []; listNode.scrollTop = 0
  globalThis.requestAnimationFrame = callback => setTimeout(callback,0)
  globalThis.cancelAnimationFrame = clearTimeout
  globalThis.fetch = async url => {
    calls.push(url)
    const status = url.endsWith('/parks') ? parkStatus : url.endsWith('/geometry') ? geometryStatus : 200
    return {ok:status === 200,status,json:async () => status !== 200 ? {detail:'Unavailable'}
      : url.endsWith('/parks') ? parks : url.endsWith('/geometry') ? {osm_relation:1, lines:[], profile:[]}
        : {summary:{count:0},reviews:[]}}
  }
})
afterEach(async () => {if (tree) await act(async () => tree.unmount()); tree = null; Object.assign(globalThis,globals)})
const text = node => typeof node === 'string' ? node : (node.children || []).map(text).join('')
const button = label => tree.root.findAllByType('button').find(b => text(b).includes(label))
const parkButton = label => tree.root.findByProps({'aria-label':'Choose a park'}).findAllByType('button').find(b => text(b).includes(label))
const rows = () => tree.root.findAllByProps({className:'catalog-row'})
async function mount() {
  await act(async () => {tree = create(React.createElement(Catalog,{trails, summaries:{}, onReview:t => reviewed.push(t),
    reviewsVersion:0,onOfficialArea:() => {},active:true,loading:false}),
    {createNodeMock:element => element.props.className === 'catalog-list' ? listNode : {focus(){}}})})
}

test('park/search compose, and detail Back restores filters and scroll position', async () => {
  await mount(); assert.equal(rows().length,2)
  await act(async () => parkButton('Rothrock').props.onClick())
  await act(async () => tree.root.findByProps({type:'search'}).props.onChange({target:{value:'birds'}}))
  assert.equal(rows().length,1)
  listNode.scrollTop = 145
  await act(async () => rows()[0].props.onClick())
  assert.equal(text(tree.root.findByType('h1')), 'Forest Loop')
  assert.ok(text(tree.root).includes('Route line not available yet'))
  await act(async () => button('Back to Rothrock').props.onClick())
  await act(async () => {await new Promise(resolve => setTimeout(resolve,5))})
  assert.equal(tree.root.findByProps({type:'search'}).props.value,'birds')
  assert.equal(rows().length,1); assert.equal(listNode.scrollTop,145)
})

test('kept behind a hiker profile: the trail page stays as it was (no reload, same scroll)', async () => {
  const detailNode = {scrollTop:0, focus(){}}
  const props = active => ({trails, summaries:{}, onReview(){}, reviewsVersion:0, onOfficialArea(){}, active, kept:!active, loading:false})
  await act(async () => {tree = create(React.createElement(Catalog,props(true)),
    {createNodeMock:element => element.props.className === 'catalog-list' ? listNode : element.props.className === 'catalog-detail' ? detailNode : {focus(){}}})})
  await act(async () => rows()[0].props.onClick())
  await act(async () => tree.root.findByProps({className:'catalog-detail'}).props.onScroll({currentTarget:{scrollTop:420}}))
  const fetched = calls.length
  await act(async () => tree.update(React.createElement(Catalog,props(false))))
  assert.equal(text(tree.root.findByType('h1')), 'Forest Loop')
  detailNode.scrollTop = 0   // a hidden scroll box may lose its position
  await act(async () => tree.update(React.createElement(Catalog,props(true))))
  assert.equal(calls.length, fetched)
  assert.equal(detailNode.scrollTop, 420)
})

test('geometry outage can retry; review action reuses the original trail callback', async () => {
  geometryStatus = 503
  await mount(); await act(async () => rows()[0].props.onClick())
  assert.ok(text(tree.root).includes("Couldn't load the route line"))
  geometryStatus = 200
  await act(async () => button('Retry').props.onClick())
  assert.equal(calls.filter(url => url.endsWith('/geometry')).length,2)
  assert.ok(text(tree.root).includes('OpenStreetMap contributors'))
  await act(async () => button('I finished this trail').props.onClick())
  assert.equal(reviewed[0],trails[0])
})

test('a park API outage leaves all trails searchable and offers a retry', async () => {
  parkStatus = 503
  await mount(); assert.equal(rows().length,2)
  assert.ok(text(tree.root).includes('Park filters are temporarily unavailable'))
  parkStatus = 200
  await act(async () => button('Retry parks').props.onClick())
  await act(async () => parkButton('Lake Park').props.onClick())
  assert.equal(rows().length,1); assert.ok(text(rows()[0]).includes('Lake Walk'))
})
