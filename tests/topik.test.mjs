import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseTopikExamples, findTopikExamples } from '../dist/assets/topik.js';

const bytes = await fs.readFile(new URL('../dist/data/topik1.csv', import.meta.url));
const { examples, warnings } = parseTopikExamples(bytes.toString('utf8'));

test('bundled TOPIK1 is unchanged and maps the literal E/F/G/K/N columns', () => {
  assert.equal(bytes.length, 162451);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '3d1ff3c4a6a16f166e0f095147210422796604e1aca38b1b508b9c4b1ea05d63');
  assert.equal(examples.length, 825);
  assert.equal(examples.filter(entry => entry.english).length, 665);
  assert.equal(examples.filter(entry => entry.japanese).length, 825);
  assert.equal(examples.filter(entry => entry.exampleKo).length, 275);
  assert.equal(examples.filter(entry => entry.exampleJa).length, 273);
  assert.equal(new Set(examples.map(entry => entry.id)).size, 825);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /3373行/);
  const price = examples.find(entry => entry.korean === '가격');
  assert.equal(price.english, 'price');
  assert.equal(price.japanese, '価格');
  assert.equal(price.exampleKo, '크기에 따라 가격이 다릅니다');
  assert.equal(price.exampleJa, '大きさによって値段が違います');
});

test('character searches inspect E only, retaining literal source order', () => {
  assert.equal(findTopikExamples(examples, '가').length, 22);
  assert.deepEqual(findTopikExamples(examples, '각').map(entry => entry.korean), ['생각하다']);
  assert.deepEqual(findTopikExamples(examples, '한').map(entry => entry.korean), ['한복']);
  assert.deepEqual(findTopikExamples(examples, 'price'), []);
  assert.deepEqual(findTopikExamples(examples, '価格'), []);
  const matches = findTopikExamples(examples, '가');
  assert.equal(matches[0].korean, '나가다');
  assert.ok(matches.some(entry => entry.korean === '가다'));
});

test('exact words precede substring hits and duplicate array terms do not duplicate rows', () => {
  const entries = [
    { id: 'long', korean: '들어가다' },
    { id: 'exact', korean: '가다' },
    { id: 'other', korean: '나가다' },
  ];
  assert.deepEqual(findTopikExamples(entries, [' 가다 ', '가다', '가']).map(entry => entry.id), ['exact', 'long', 'other']);
  assert.deepEqual(entries.map(entry => entry.id), ['long', 'exact', 'other']);
  assert.deepEqual(findTopikExamples(examples, [' ', '', null]), []);
  assert.deepEqual(findTopikExamples(examples, ' '), []);
});

test('source senses and missing English remain unchanged', () => {
  const arms = findTopikExamples(examples, '팔').filter(entry => entry.korean === '팔');
  assert.equal(arms.length, 2);
  assert.deepEqual(arms.map(entry => entry.japanese), ['腕', '8']);
  assert.deepEqual(arms.map(entry => entry.english), ['8', '8']);
  assert.deepEqual(findTopikExamples(examples, '눈').filter(entry => entry.korean === '눈').map(entry => entry.japanese), ['雪', '目、雪']);
  assert.equal(examples.find(entry => entry.korean === '그림 그리다').english, '');
});

test('NFD Korean composes for parsing and matching without fuzzy spelling', () => {
  assert.deepEqual(findTopikExamples(examples, '각'.normalize('NFD')).map(entry => entry.korean), ['생각하다']);
  const parsed = parseTopikExamples('No,a,b,c,E,F,G,H,I,J,K,L,M,N\n1,,,,가다,go,行く,,,,가요,,,行きます').examples;
  assert.equal(parsed[0].korean, '가다');
  assert.equal(parsed[0].exampleKo, '가요');
  assert.equal(findTopikExamples(parsed, '가').length, 1);
  assert.equal(findTopikExamples(parsed, '각').length, 0);
});

test('identical content is deduplicated while distinct sentences and senses survive', () => {
  const header = 'No,a,b,c,E,F,G,H,I,J,K,L,M,N\n';
  const row = '1,,,,가다,go,行く,,,,가요,,,行きます';
  const duplicate = row.replace(/^1/, '2');
  const otherExample = row.replace(/^1/, '3').replace('가요', '집에 가요');
  const parsed = parseTopikExamples(`${header}${row}\n${duplicate}\n${otherExample}`);
  assert.equal(parsed.examples.length, 2);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /同じ1行/);
});

test('CSV text, formula-like values, markup and regex characters remain literal data', () => {
  const text = 'No,a,b,c,E,F,G,H,I,J,K,L,M,N\n1,,,,가.*?,=IMPORTXML(A1),<img onerror=alert(1)>,,,,가 <script>text</script>,,,"日本語,の例文"';
  const parsed = parseTopikExamples(text).examples;
  assert.equal(parsed[0].english, '=IMPORTXML(A1)');
  assert.equal(parsed[0].japanese, '<img onerror=alert(1)>');
  assert.equal(parsed[0].exampleKo, '가 <script>text</script>');
  assert.equal(parsed[0].exampleJa, '日本語,の例文');
  assert.equal(findTopikExamples(parsed, '.*?').length, 1);
  assert.equal(findTopikExamples(parsed, '^가').length, 0);
});
