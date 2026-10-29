import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/category-sets.js';

const csv = 'category_id,カテゴリ名,教材,対象列,条件,値,条件の結合,表示順\na,全件,one,,全件,,AND,1';
const publishedPath = '/spreadsheets/d/e/2PACX-1vRh2suLk8kb79htB7NQhVfed8BuWPiZ04oqQCWsShnxmZDwvtoejMTtINRJgRyTmc_ysQIvjfhGSFnL/pub';
const request = (query = '', method = 'GET') => new Request(`https://study.test/api/category-sets${query}`, { method });
const response = () => new Response(csv, { headers: { 'content-type': 'text/csv' } });

test('category API defaults to the published category_enshu CSV', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return response(); });
  const result = await onRequest({ request: request(), env: {} });
  assert.equal(result.status, 200);
  assert.equal(await result.text(), csv);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 1);
  const source = new URL(calls[0].url);
  assert.equal(source.protocol, 'https:');
  assert.equal(source.hostname, 'docs.google.com');
  assert.equal(source.pathname, publishedPath);
  assert.equal(source.searchParams.get('gid'), '297489818');
  assert.equal(source.searchParams.get('output'), 'csv');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.cache, 'no-store');
});

test('category API permits an explicit published Google CSV override', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => { calls.push(url); return response(); });
  const override = 'https://docs.google.com/spreadsheets/d/e/public-source/pub?gid=99&output=csv';
  const result = await onRequest({ request: request(), env: { CATEGORY_SHEET_CSV_URL: override } });
  assert.equal(result.status, 200);
  assert.equal(await result.text(), csv);
  assert.deepEqual(calls, [override]);
});

test('category API rejects an unsafe override before network access', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return response(); });
  const unsafe = [
    'https://example.test/sheet.csv',
    'http://docs.google.com/spreadsheets/d/e/public-source/pub?output=csv',
    'https://docs.google.com/spreadsheets/d/e/public-source/pub?output=html',
    'https://name:secret@docs.google.com/spreadsheets/d/e/public-source/pub?output=csv',
    'https://docs.google.com:444/spreadsheets/d/e/public-source/pub?output=csv',
  ];
  for (const source of unsafe) {
    assert.equal((await onRequest({ request: request(), env: { CATEGORY_SHEET_CSV_URL: source } })).status, 503, source);
  }
  assert.equal(calls, 0);
});

test('request query parameters cannot replace the category CSV source or gid', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => { calls.push(new URL(url)); return response(); });
  const result = await onRequest({ request: request('?url=https%3A%2F%2Fattacker.test%2Fsheet.csv&gid=0&source=https%3A%2F%2Fattacker.test'), env: {} });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hostname, 'docs.google.com');
  assert.equal(calls[0].pathname, publishedPath);
  assert.equal(calls[0].searchParams.get('gid'), '297489818');
  assert.equal(calls[0].searchParams.has('url'), false);
  assert.equal(calls[0].searchParams.has('source'), false);
});

test('category API remains read-only and rejects POST without fetching', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return response(); });
  const result = await onRequest({ request: request('', 'POST'), env: {} });
  assert.equal(result.status, 405);
  assert.equal(result.headers.get('allow'), 'GET, HEAD');
  assert.equal(calls, 0);
});
