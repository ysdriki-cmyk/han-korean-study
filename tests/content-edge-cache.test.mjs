import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedSheetCSV,validContentCSV} from '../functions/_lib/content-cache.js';

const source='https://docs.google.com/spreadsheets/d/e/cache-tests/pub?gid=1&output=csv';
const old='id_sentence,例文_韓国語,例文_日本語\n1,안녕,こんにちは';
const latest=old.replace('こんにちは','こんにちは！');
class MemoryCache{
  map=new Map();
  async match(key){return this.map.get(key.url)?.clone();}
  async put(key,response){this.map.set(key.url,response.clone());}
}
function setup(){let time=Date.parse('2026-11-05T00:00:00Z');const cache=new MemoryCache(),pending=[];return {cache,now:()=>time,advance:ms=>time+=ms,pending,context:{request:new Request('https://study.test/api/content/sentence'),waitUntil:p=>pending.push(p)}};}
const response=text=>new Response(text,{headers:{'Content-Type':'text/csv'}});

test('a shared fresh CSV avoids upstream requests and HEAD has no body',async t=>{
  const f=setup();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response(old);});
  const miss=await cachedSheetCSV(f.context,source,'sentence',f);assert.equal(miss.headers.get('X-Content-Cache'),'MISS');assert.equal(await miss.text(),old);
  const hit=await cachedSheetCSV({...f.context,request:new Request(f.context.request.url+'?ignored=1',{method:'HEAD'})},source,'sentence',f);
  assert.equal(hit.headers.get('X-Content-Cache'),'HIT');assert.equal(await hit.text(),'');assert.equal(calls,1);
  assert.equal(hit.headers.get('Cache-Control'),'no-store');
});

test('stale content returns before a slow refresh and is then replaced by validated data',async t=>{
  const f=setup();t.mock.method(globalThis,'fetch',async()=>response(old));await cachedSheetCSV(f.context,source,'sentence',f);
  f.advance(300001);let release;globalThis.fetch=()=>new Promise(resolve=>release=()=>resolve(response(latest)));
  const stale=await cachedSheetCSV(f.context,source,'sentence',f);
  assert.equal(stale.headers.get('X-Content-Cache'),'STALE');assert.equal(await stale.text(),old);
  release();await Promise.all(f.pending);
  const fresh=await cachedSheetCSV(f.context,source,'sentence',f);assert.equal(await fresh.text(),latest);assert.equal(fresh.headers.get('X-Content-Cache'),'HIT');
});

test('loading exports and duplicate IDs never replace the last valid copy',async t=>{
  const f=setup();t.mock.method(globalThis,'fetch',async()=>response(old));await cachedSheetCSV(f.context,source,'sentence',f);
  for(const bad of ['読み込んでいます...',old+'\n1,가요,行きます']){
    f.advance(300001);globalThis.fetch=async()=>response(bad);
    const result=await cachedSheetCSV(f.context,source,'sentence',f);assert.equal(await result.text(),old);await Promise.all(f.pending);
  }
  globalThis.fetch=async()=>{throw Error('offline');};
  assert.equal(await (await cachedSheetCSV(f.context,source,'sentence',f)).text(),old);await Promise.all(f.pending);
});

test('source changes and cold invalid exports cannot use an unrelated cached copy',async t=>{
  const f=setup();t.mock.method(globalThis,'fetch',async()=>response(old));await cachedSheetCSV(f.context,source,'sentence',f);
  globalThis.fetch=async()=>response('読み込んでいます...');
  assert.equal((await cachedSheetCSV(f.context,source.replace('gid=1','gid=2'),'sentence',f)).status,502);
  const result=await cachedSheetCSV({...f.context,request:new Request(f.context.request.url,{method:'POST'})},source,'sentence',f);assert.equal(result.status,405);
});

test('public export validation rejects empty/malformed content and accepts all current schemas',()=>{
  assert.equal(validContentCSV('sentence',old),true);
  assert.equal(validContentCSV('sentence','id_sentence,例文_韓国語,例文_日本語\n1,안녕,'),false);
  assert.equal(validContentCSV('kanji','id_one,韓国語,漢字\n1,가,家'),true);
  assert.equal(validContentCSV('vocabulary','id,韓国語,英語\n1,가게,shop'),true);
  assert.equal(validContentCSV('category_enshu','category_id,カテゴリ名,教材,対象列,条件,値,条件の結合,表示順\na,全件,sentence,,全件,,AND,1'),true);
});

test('simultaneous cold requests share one upstream fetch and retain separate response bodies',async t=>{
  const f=setup();let calls=0,release;
  t.mock.method(globalThis,'fetch',()=>{calls++;return new Promise(resolve=>release=()=>resolve(response(old)));});
  const first=cachedSheetCSV(f.context,source,'sentence',f);
  const second=cachedSheetCSV(f.context,source,'sentence',f);
  while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  release();const results=await Promise.all([first,second]);
  assert.deepEqual(await Promise.all(results.map(result=>result.text())),[old,old]);assert.equal(calls,1);
});
