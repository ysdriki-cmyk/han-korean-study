import {proxySheetCSV} from '../api/cards.js';
import {parseCSV} from '../../dist/assets/core.js';
import {sheetHeader} from '../../dist/assets/sheet-fields.js';
import {parseCategorySheet} from '../../dist/assets/category-sheet.js';

const FRESH_MS=5*60*1000, RETAIN_SECONDS=24*60*60;
const inFlight=new Map();

/** Reject Google's loading/error exports before replacing a known-good CSV. */
export function validContentCSV(kind,text) {
  if(kind==='category_enshu') {
    const result=parseCategorySheet(text);
    return result.sets.length>0 && result.warnings.length===0;
  }
  const rows=parseCSV(text), headers=(rows[0]||[]).map(value=>sheetHeader(value).normalize('NFKC'));
  const column=names=>names.map(name=>headers.indexOf(name)).find(index=>index>=0) ?? -1;
  const id=column(kind==='sentence'?['id_sentence']:['id','id_word','id_one','id_kan','no.','no','番号']);
  const ko=column(kind==='sentence'?['例文_韓国語']:['韓国語','han','ハングル','korean','ko_word','moments いろいろhello talk']);
  const answers=kind==='sentence'?['例文_日本語']:kind==='vocabulary'?['日本語','japanese','和訳','意味','youtube subtitle','英語','english','en']:['出題ヒント','漢字','kanji','漢字候補','一覧','hanja','解説・一覧','解説','解説/一覧','解説一覧','意味','meaning','notes','メモ'];
  const answerColumns=answers.map(name=>headers.indexOf(name)).filter(index=>index>=0);
  if(id<0 || ko<0 || !answerColumns.length) return false;
  const ids=new Set();
  for(const row of rows.slice(1)) {
    const value=index=>String(row[index]??'').trim();
    if(!value(id) || !value(ko) || !answerColumns.some(index=>value(index))) continue;
    if(ids.has(value(id))) return false;
    ids.add(value(id));
  }
  return ids.size>0;
}

function clientResponse(response,request,state) {
  const headers=new Headers(response.headers);
  headers.set('Cache-Control','no-store');
  headers.set('X-Content-Cache',state);
  return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
}

/** Public textbook CSV only. Cache API is optional and needs no R2 binding. */
export async function cachedSheetCSV(context,source,kind,{cache=globalThis.caches?.default,now=Date.now}={}) {
  const {request}=context;
  if(!cache || !['GET','HEAD'].includes(request.method) || !source) return proxySheetCSV(request,source);
  const url=new URL(request.url);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source))),value=>value.toString(16).padStart(2,'0')).join('');
  url.search=`?public-content-cache=v1-${kind}-${hash}`;
  const key=new Request(url,{method:'GET'});
  let cached;
  try { cached=await cache.match(key); } catch { return proxySheetCSV(request,source); }
  if(cached?.headers.get('X-Content-Validated')!=='1') cached=null;
  const cachedAt=Date.parse(cached?.headers.get('X-Content-Cached-At')||'');
  if(cached && Number.isFinite(cachedAt) && now()-cachedAt<FRESH_MS) return clientResponse(cached,request,'HIT');
  const refresh=()=>{
    if(inFlight.has(key.url)) return inFlight.get(key.url);
    const task=(async()=>{
      const response=await proxySheetCSV(new Request(request.url),source);
      if(!response.ok) return response;
      const csv=await response.text();
      let valid=false;
      try { valid=validContentCSV(kind,csv); } catch { /* Invalid exports never enter the shared cache. */ }
      if(!valid) return new Response(JSON.stringify({error:'公開CSVの内容を確認できませんでした。'}),{status:502,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      const headers=new Headers(response.headers);
      headers.set('Cache-Control',`public, max-age=${RETAIN_SECONDS}`);
      headers.set('X-Content-Cached-At',new Date(now()).toISOString());
      headers.set('X-Content-Validated','1');
      const fresh=new Response(csv,{headers});
      try { await cache.put(key,fresh.clone()); } catch { /* Storage failure does not hide fresh valid content. */ }
      return fresh;
    })().finally(()=>inFlight.delete(key.url));
    inFlight.set(key.url,task);return task;
  };
  if(cached && typeof context.waitUntil==='function') {
    context.waitUntil(refresh().then(()=>{}).catch(()=>{}));
    return clientResponse(cached,request,'STALE');
  }
  try {
    const fresh=await refresh();
    if(fresh.ok) return clientResponse(fresh.clone(),request,'MISS');
    if(cached) return clientResponse(cached,request,'STALE');
    return clientResponse(fresh,request,'MISS');
  } catch {
    if(cached) return clientResponse(cached,request,'STALE');
    return new Response(JSON.stringify({error:'教材を取得できませんでした。'}),{status:502,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  }
}
