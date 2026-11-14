import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { inspectContent, inspectCategoryContent, summarizeLearning } from '../dist/assets/admin-data.js';
import { DIAGNOSTICS_KEY, readContentDiagnostics, recordContentDiagnostics } from '../dist/assets/content-diagnostics.js';
import { readContentSnapshot, writeContentCache } from '../dist/assets/content-cache.js';
import { DECKS, parseDeck } from '../dist/assets/decks.js';
import { nextReviewFor } from '../dist/assets/review.js';
import { sentenceWordIssues } from '../dist/assets/sentences.js';

const required = ['id_sentence','例文_韓国語','例文_日本語','セットID','順番'];
const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const csv = (row, headers = required) => [headers, headers.map(header => row[header] ?? '')].map(values => values.map(quote).join(',')).join('\n');
const sample = overrides => ({id_sentence:'var_eat_001',例文_韓国語:'김밥을 먹었어.',例文_日本語:'キンパを食べた。',セットID:'eat-1',順番:'1',...overrides});
const text = csv(sample());
function memoryStorage() {
  const entries = new Map([['han-hanja:learning:v3', JSON.stringify({version:3,records:{'sentence:var_eat_001':{assessments:{write:{attempts:3}}}}})]]);
  const writes = [];
  return {entries,writes,getItem:key=>entries.get(key) ?? null,setItem(key,value){writes.push(key);entries.set(key,value);}};
}

test('variation admin inspection follows the dedicated parser and actual reordered source cells without a genre tag', () => {
  const headers = ['順番','変形タイプ','id_sentence','例文_日本語','セット名','セットID','例文_韓国語','練習指示','変化ポイント','別解_韓国語','使用韓国語_12','文中表記_12','文中訳_12','使用単語ID_12','話し方','距離感・対象','使い方メモ'];
  const row = sample({順番:'２',変形タイプ:'否定',例文_韓国語:'김밥을 안 먹었어.',例文_日本語:'キンパを食べなかった。',セット名:'キンパを食べた',練習指示:'食べなかったことにする',変化ポイント:'안を付ける',別解_韓国語:'김밥을 먹지 않았어.\n김밥은 안 먹었어.',使用韓国語_12:'먹다',文中表記_12:'먹었어',文中訳_12:'食べた',使用単語ID_12:'word-1',話し方:'タメ口','距離感・対象':'友達',使い方メモ:'自分が食べたことを話す'});
  const data = inspectContent('variation', csv(row, headers));
  assert.equal(data.count, 1);
  assert.equal(data.rawRows, 1);
  assert.deepEqual(data.warnings, []);
  const byHeader = Object.fromEntries(data.columns.map(column => [column.header,column]));
  assert.equal(byHeader['順番'].cell, 'A1');
  assert.equal(byHeader['順番'].sampleCell, 'A2');
  assert.equal(byHeader['順番'].sample, '２');
  assert.equal(byHeader['例文_韓国語'].cell, 'G1');
  assert.equal(byHeader['別解_韓国語'].sample, row['別解_韓国語']);
  for (const header of headers) assert.doesNotMatch(byHeader[header].use, /専用の用途を設定していません/u);
  assert.match(byHeader['セットID'].use, /変形練習セット/u);
  assert.match(byHeader['順番'].use, /元の文/u);
  assert.match(byHeader['別解_韓国語'].use, /全文/u);
  const genre = inspectContent('variation', csv(sample({ジャンル:'#食事'}), [...required,'ジャンル'])).columns.at(-1);
  assert.match(genre.use, /省略できる/u);
  assert.equal(genre.sample, '#食事');
});

test('empty, header-only and malformed variation CSVs cannot appear as a successful admin inspection', () => {
  for (const invalid of ['', required.join(','), 'id,韓国語,日本語\n1,먹다,食べる', csv(sample({セットID:''})),
    csv(sample({順番:'0'})), csv(sample({例文_日本語:''})), csv(sample(), required.filter(header => header !== '順番')),
    csv(sample({ジャンル:'#conversation'}), [...required,'ジャンル'])]) {
    assert.throws(() => inspectContent('variation', invalid));
  }
  assert.equal(inspectContent('variation', text).count, 1);
});

test('variation content diagnostics and cache stay independent while preserving learning records', () => {
  const storage = memoryStorage();
  const learning = storage.getItem('han-hanja:learning:v3');
  const at = '2026-11-14T10:00:00.000Z';
  recordContentDiagnostics(storage, 'sentence', {source:'remote',checkedAt:at,cardCount:772,httpStatus:200});
  const before = JSON.stringify(readContentDiagnostics(storage).decks.sentence);
  assert.equal(recordContentDiagnostics(storage, 'variation', {source:'remote',checkedAt:at,cardCount:24,httpStatus:200,csv:'never stored',answer:'never stored'}), true);
  assert.equal(recordContentDiagnostics(storage, 'variation', {source:'cached',checkedAt:'2026-11-14T11:00:00.000Z',cardCount:24,httpStatus:502,error:'variationシートを確認してください。'}), true);
  const state = readContentDiagnostics(storage);
  assert.equal(state.decks.variation.source, 'cached');
  assert.equal(state.decks.variation.lastSuccessAt, at);
  assert.equal(state.decks.variation.cardCount, 24);
  assert.equal(JSON.stringify(state.decks.sentence), before);
  assert.doesNotMatch(storage.getItem(DIAGNOSTICS_KEY), /never stored/u);
  assert.equal(writeContentCache(storage, 'sentence', '/api/content/sentence', 'ordinary source', at), true);
  assert.equal(writeContentCache(storage, 'variation', '/api/content/variation', text, at), true);
  assert.equal(readContentSnapshot(storage, 'variation', '/api/content/variation').text, text);
  assert.equal(readContentSnapshot(storage, 'sentence', '/api/content/sentence').text, 'ordinary source');
  assert.equal(readContentSnapshot(storage, 'variation', '/api/content/sentence'), null);
  assert.equal(storage.getItem('han-hanja:learning:v3'), learning);
  assert.ok(storage.writes.every(key => key !== 'han-hanja:learning:v3'));
});

async function adminHarness({body = text} = {}) {
  const storage = memoryStorage(), elements = new Map(), requests = [];
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector,{innerHTML:'',textContent:'',addEventListener(){},insertAdjacentHTML(_where,html){this.innerHTML+=html;}});
    return elements.get(selector);
  };
  const document = {querySelector:element,querySelectorAll:()=>[],addEventListener(){}};
  const window = {APP_CONFIG:{decks:{sentence:{csvUrl:'/api/content/sentence'}},variation:{csvUrl:'/api/content/variation',fallbackCsvUrl:'./data/variation.csv'}},addEventListener(){}};
  const source = (await fs.readFile(new URL('../dist/assets/admin.js', import.meta.url), 'utf8'))
    .replace(/^import[^\n]+\n/gmu,'')
    .replace(/routeTo\(routeFromURL\(\)\);\s*recheck\(\);\s*$/u,'');
  const context = vm.createContext({document,window,localStorage:storage,location:{origin:'https://study.example',pathname:'/admin/'},
    DECKS,parseDeck,inspectContent,inspectCategoryContent,summarizeLearning,readContentSnapshot,readContentDiagnostics,DIAGNOSTICS_KEY,nextReviewFor,sentenceWordIssues,
    URL,TextEncoder,AbortController,setTimeout,clearTimeout,fetch:async url=>{
      requests.push(url.href);
      return {ok:true,status:200,headers:new Headers({'content-type':'text/csv','x-content-cache':'HIT','x-content-cached-at':'2026-11-14T10:00:00.000Z'}),text:async()=>body};
    }});
  vm.runInContext(`${source}\nglobalThis.adminTest={contentIds,endpoint,inspectEndpoint,cachedInfo,renderContent,renderSchema,renderStorage,results};`,context);
  return {api:context.adminTest,storage,elements,requests};
}

test('admin connects to the dedicated variation endpoint and renders its independent cache and diagnostic source read-only', async () => {
  const {api,storage,elements,requests} = await adminHarness();
  assert.ok(api.contentIds.includes('variation'));
  assert.equal(api.endpoint('variation'), '/api/content/variation');
  const at = '2026-11-14T10:00:00.000Z';
  writeContentCache(storage, 'variation', '/api/content/variation', text, at);
  recordContentDiagnostics(storage, 'variation', {source:'cached',lastSuccessAt:at,cardCount:1,error:'接続を再確認中'});
  const before = JSON.stringify([...storage.entries]);
  storage.writes.length = 0;
  const result = await api.inspectEndpoint('variation');
  assert.equal(result.ok, true);
  assert.equal(result.data.count, 1);
  assert.deepEqual(requests, ['https://study.example/api/content/variation']);
  assert.equal(api.cachedInfo('variation').count, 1);
  api.results.set('variation', result);
  api.renderContent(); api.renderSchema(); api.renderStorage();
  assert.match(elements.get('#content-cards').innerHTML, /<h2>variation<\/h2>/u);
  assert.match(elements.get('#content-cards').innerHTML, /\/api\/content\/variation/u);
  assert.match(elements.get('#content-cards').innerHTML, /接続を再確認中/u);
  assert.match(elements.get('#schema-tables').innerHTML, /変形練習セット/u);
  assert.match(elements.get('#storage-summary').innerHTML, /han-hanja:content:v1:variation/u);
  assert.equal(JSON.stringify([...storage.entries]), before);
  assert.deepEqual(storage.writes, []);
});

test('admin reports header-only variation as CSV input failure while retaining its last valid cache', async () => {
  const {api,storage} = await adminHarness({body:required.join(',')});
  writeContentCache(storage, 'variation', '/api/content/variation', text, '2026-11-14T10:00:00.000Z');
  const before = JSON.stringify([...storage.entries]);
  storage.writes.length = 0;
  const result = await api.inspectEndpoint('variation');
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.failureKind, 'input');
  assert.ok(result.error);
  assert.equal(api.cachedInfo('variation').count, 1);
  assert.equal(JSON.stringify([...storage.entries]), before);
  assert.deepEqual(storage.writes, []);
});
