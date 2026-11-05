import {readContentSnapshot} from './content-cache.js?v=2';

/** Startup never waits on Google while a valid stored or bundled copy exists. */
export async function loadInitialContent({storage,id,url,bundledUrl,parse,fetchText}) {
  const snapshot=readContentSnapshot(storage,id,url);
  if(snapshot) {
    try { return {...snapshot,...parse(snapshot.text),source:'cached'}; } catch { /* Use the shipped snapshot. */ }
  }
  try { return {...await fetchText(bundledUrl),source:'bundled'}; }
  catch {
    const result=await fetchText(url);
    return {...result,source:'remote',fetchedAt:new Date().toISOString()};
  }
}
