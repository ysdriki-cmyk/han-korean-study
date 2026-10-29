import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/category-sets.js';

test('category API requires its own published source and remains read-only', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return new Response('category_id,カテゴリ名,教材,対象列,条件,値,条件の結合,表示順\na,全件,one,,全件,,AND,1', { headers: { 'content-type': 'text/csv' } });
  });
  const request = new Request('https://study.test/api/category-sets');
  assert.equal((await onRequest({ request, env: {} })).status, 503);
  assert.equal((await onRequest({ request, env: { CATEGORY_SHEET_CSV_URL: 'https://example.test/sheet.csv' } })).status, 503);
  assert.equal(calls, 0);
  const env = { CATEGORY_SHEET_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/public-source/pub?gid=99&output=csv' };
  const result = await onRequest({ request, env });
  assert.equal(result.status, 200);
  assert.match(await result.text(), /category_id/);
  assert.equal(calls, 1);
  assert.equal((await onRequest({ request: new Request(request.url, { method: 'POST' }), env })).status, 405);
  assert.equal(calls, 1);
});
