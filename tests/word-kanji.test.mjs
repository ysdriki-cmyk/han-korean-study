import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWordKanjiReferences, findWordKanjiReferences } from '../dist/assets/word-kanji.js';
import { renderVocabularyExample } from '../dist/assets/topik-view.js';

test('word references use only the one sheet correspondence cells in syllable order', () => {
  const source = 'id,韓国語,出題ヒント,漢字,解説・一覧,必須\n'
    + '176,상,問題のヒント,相、常,上、商、想、箱、傷,！\n'
    + '374,항,,行、港、航、恒,降、抗、項,！\n'
    + '375,항,,行、港、航、恒,違う説明,\n'
    + '376,항상,,常時,単語全体,\n'
    + '377,하,,,説明しかない,\n';
  const entries = parseWordKanjiReferences(source);
  const before = JSON.stringify(entries);
  assert.deepEqual(findWordKanjiReferences(entries, '항상항'), [
    {korean:'항',kanji:'行、港、航、恒'}, {korean:'상',kanji:'相、常'},
  ]);
  assert.deepEqual(findWordKanjiReferences(entries, '日本語'), []);
  assert.deepEqual(findWordKanjiReferences(entries, '하'), []);
  assert.equal(JSON.stringify(entries), before);
});

test('reordered headers and decomposed Korean work without falling back to explanations', () => {
  const entries = parseWordKanjiReferences('\uFEFF漢字,解説・一覧,韓国語,出題ヒント\n恒,秘密,항,ヒント');
  assert.deepEqual(findWordKanjiReferences(entries, '항상'), [{korean:'항',kanji:'恒'}]);
  assert.deepEqual(parseWordKanjiReferences('韓国語,解説・一覧\n항,恒'), []);
  assert.deepEqual(parseWordKanjiReferences(''), []);
  assert.deepEqual(parseWordKanjiReferences('韓国語,漢字候補\n상,常'), [{korean:'상',kanji:'常'}]);
  assert.deepEqual(parseWordKanjiReferences('韓国語,漢字候補,漢字\n상,別の候補,常'), [{korean:'상',kanji:'常'}]);
});

test('compact correspondences follow the translation and omit headers and old notes', () => {
  const html = renderVocabularyExample({exampleKo:'항상 말하잖아요',exampleJp:'いつも言ってるじゃないですか',notes:'古い説明'}, [
    {korean:'항',kanji:'行、港、航、恒'}, {korean:'상',kanji:'相、常 <script>'},
  ]);
  assert.equal((html.match(/class="word-kanji-piece"/g)||[]).length, 2);
  assert.equal((html.match(/class="word-kanji-plus"/g)||[]).length, 1);
  assert.ok(html.includes('aria-label="항を読み上げ"'));
  assert.ok(html.indexOf('いつも言ってるじゃないですか') < html.indexOf('word-kanji-reference'));
  assert.ok(html.includes('相、常 &lt;script&gt;'));
  for (const hidden of ['<table', '<script>', '古い説明', '解説・一覧', 'TOPIK1', '韓国語</th>', '漢字</th>']) assert.ok(!html.includes(hidden));
  assert.ok(renderVocabularyExample({}, [{korean:'항',kanji:'恒'}]).includes('word-kanji-reference'));
  assert.equal(renderVocabularyExample({}), '');
});
