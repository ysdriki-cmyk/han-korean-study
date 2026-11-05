import test from 'node:test';
import assert from 'node:assert/strict';
import {loadInitialContent} from '../dist/assets/content-startup.js';
import {writeContentCache} from '../dist/assets/content-cache.js';
import {parseDeck} from '../dist/assets/decks.js';

const text='id_sentence,例文_韓国語,例文_日本語\n1,안녕,こんにちは';
const parse=text=>{const data=parseDeck('sentence',text);if(!data.cards.length)throw Error('empty');return data;};
function fixture(){const map=new Map([['han-hanja:learning:v3','keep history']]);return {map,storage:{getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)},id:'sentence',url:'/api/content/sentence',bundledUrl:'/data/sentences.csv',parse};}

test('valid stored content opens without issuing any request or changing learning records',async()=>{
  const f=fixture();writeContentCache(f.storage,f.id,f.url,text);
  const result=await loadInitialContent({...f,fetchText:()=>{throw Error('must not fetch');}});
  assert.equal(result.source,'cached');assert.equal(result.cards.length,1);
  assert.equal(f.map.get('han-hanja:learning:v3'),'keep history');
});

test('first visit and invalid cache use the bundled snapshot before any remote call',async()=>{
  for(const cached of [null,'読み込んでいます...']){
    const f=fixture();if(cached)writeContentCache(f.storage,f.id,f.url,cached);
    const calls=[];
    const result=await loadInitialContent({...f,fetchText:async url=>{calls.push(url);assert.equal(url,f.bundledUrl);return {text,...parse(text)};}});
    assert.equal(result.source,'bundled');assert.deepEqual(calls,[f.bundledUrl]);
  }
});

test('missing bundled data can recover through the source while storage errors remain harmless',async()=>{
  const f=fixture(),calls=[];f.storage={getItem(){throw Error('disabled');}};
  const result=await loadInitialContent({...f,fetchText:async url=>{calls.push(url);if(url===f.bundledUrl)throw Error('not found');return {text,...parse(text)};}});
  assert.equal(result.source,'remote');assert.deepEqual(calls,[f.bundledUrl,f.url]);assert.ok(result.fetchedAt);
});
