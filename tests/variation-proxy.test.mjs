import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/content/[deck].js';

const csv='id_sentence,セットID,セット名,順番,変形タイプ,練習指示,例文_韓国語,例文_日本語\nv_1,eat,食べた,1,基本文,友達に伝える,김밥을 먹었어.,キンパを食べた。';
const publishedPath='/spreadsheets/d/e/2PACX-1vRh2suLk8kb79htB7NQhVfed8BuWPiZ04oqQCWsShnxmZDwvtoejMTtINRJgRyTmc_ysQIvjfhGSFnL/pub';
const request=(query='',method='GET')=>new Request(`https://study.test/api/content/variation${query}`,{method});
const context=(fields={})=>({request:request(),params:{deck:'variation'},env:{},...fields});
const response=()=>new Response(csv,{headers:{'content-type':'text/csv'}});

test('variation API defaults to its dedicated published sheet and preserves the sentence gid',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return response();});
  const result=await onRequest(context());
  assert.equal(result.status,200);
  assert.equal(await result.text(),csv);
  assert.equal(result.headers.get('cache-control'),'no-store');
  const source=new URL(calls[0].url);
  assert.equal(source.protocol,'https:');
  assert.equal(source.hostname,'docs.google.com');
  assert.equal(source.pathname,publishedPath);
  assert.equal(source.searchParams.get('gid'),'1475350480');
  assert.equal(source.searchParams.get('single'),'true');
  assert.equal(source.searchParams.get('output'),'csv');
  assert.equal(calls[0].options.redirect,'manual');
  assert.equal(calls[0].options.cache,'no-store');
  await onRequest(context({request:new Request('https://study.test/api/content/sentence'),params:{deck:'sentence'}}));
  assert.equal(new URL(calls[1].url).searchParams.get('gid'),'64554523');
});

test('variation API uses only its own published Google CSV override',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async url=>{calls.push(url);return response();});
  const override='https://docs.google.com/spreadsheets/d/e/variation-source/pub?gid=99&output=csv';
  const result=await onRequest(context({env:{VARIATION_SHEET_CSV_URL:override,SENTENCE_SHEET_CSV_URL:'https://docs.google.com/spreadsheets/d/e/sentence-source/pub?gid=1&output=csv'}}));
  assert.equal(result.status,200);
  assert.equal(await result.text(),csv);
  assert.deepEqual(calls,[override]);
});

test('variation source cannot be overridden by request query parameters',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async url=>{calls.push(new URL(url));return response();});
  const result=await onRequest(context({request:request('?url=https%3A%2F%2Fattacker.test%2Fdata.csv&gid=64554523&source=https%3A%2F%2Fattacker.test')}));
  assert.equal(result.status,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0].pathname,publishedPath);
  assert.equal(calls[0].searchParams.get('gid'),'1475350480');
  assert.equal(calls[0].searchParams.has('url'),false);
  assert.equal(calls[0].searchParams.has('source'),false);
});

test('variation API rejects unsafe source configuration and methods before fetching',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return response();});
  for(const source of [
    'https://attacker.test/data.csv',
    'http://docs.google.com/spreadsheets/d/e/source/pub?output=csv',
    'https://docs.google.com/spreadsheets/d/e/source/pub?output=html',
    'https://name:secret@docs.google.com/spreadsheets/d/e/source/pub?output=csv',
    'https://docs.google.com:444/spreadsheets/d/e/source/pub?output=csv',
  ]) assert.equal((await onRequest(context({env:{VARIATION_SHEET_CSV_URL:source}}))).status,503,source);
  const result=await onRequest(context({request:request('','POST')}));
  assert.equal(result.status,405);
  assert.equal(result.headers.get('allow'),'GET, HEAD');
  assert.equal((await onRequest(context({params:{deck:'__proto__'}}))).status,404);
  assert.equal(calls,0);
});

test('variation API supports HEAD and trusted redirects without a response body',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async url=>{
    calls.push(url);
    return calls.length===1
      ? new Response(null,{status:302,headers:{location:'https://doc-1.googleusercontent.com/export/variation'}})
      : response();
  });
  const result=await onRequest(context({request:request('','HEAD')}));
  assert.equal(result.status,200);
  assert.equal(result.headers.get('content-type'),'text/csv; charset=utf-8');
  assert.equal(await result.text(),'');
  assert.equal(calls.length,2);
});

test('variation API retains the existing redirect host guard',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{
    calls++;
    return new Response(null,{status:302,headers:{location:'https://googleusercontent.com.attacker.test/export'}});
  });
  assert.equal((await onRequest(context())).status,502);
  assert.equal(calls,1);
});
