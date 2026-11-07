import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../dist/assets/decks.js';
import { resolveSentenceWords } from '../dist/assets/sentences.js';
import { findSentenceWordExamples } from '../dist/assets/sentence-examples.js';
import { renderSentenceWords,renderSentenceWordExamples } from '../dist/assets/sentence-view.js';

const words=parseDeck('vocabulary','id,韓国語,英語,日本語,例文_韓国語,例文_日本語\n1,쓰다,write,書く,메모를 써요.,メモを書きます。\n2,쓰다,bitter,苦い,,\n3,수업,class,授業,,').cards;
const sentences=parseDeck('sentence','id_sentence,例文_韓国語,例文_日本語,使用韓国語_1,使用単語ID_1\ncurrent,써요.,書きます。,쓰다,1\nsame-text,써요!,書くよ！,쓰다,1\nletter,편지를 써요.,手紙を書きます。,쓰다,1\nduplicate,편지를 써요.,手紙を書きます。,쓰다,1\nbitter,커피가 써요.,コーヒーが苦いです。,쓰다,2\nfuture,다음에 써 볼게요.,今度書いてみます。,쓰다,1\nprefix,수업이 있어요.,授業があります。,수업,3\nunknown1,할 수 있어요.,できます。,수,\nunknown2,볼 수 있어요.,見られます。,수,\nwrong-id,할 수 있죠.,できますよね。,수,3').cards;
sentences[0].conversation={lessonId:'current-lesson'};
sentences[5].conversation={lessonId:'current-lesson'};

test('related examples use exact word references, preserve senses and exclude the current dialogue',()=>{
  const current=sentences[0],row=resolveSentenceWords(current,words).rows[0];
  const before=JSON.stringify({words,sentences});
  const examples=findSentenceWordExamples(row,words,sentences,current);
  assert.deepEqual(examples,[
    {korean:'메모를 써요.',japanese:'メモを書きます。'},
    {korean:'편지를 써요.',japanese:'手紙を書きます。'},
  ]);
  assert.equal(JSON.stringify({words,sentences}),before);
  assert.deepEqual(findSentenceWordExamples(resolveSentenceWords(sentences[4],words).rows[0],words,sentences,sentences[4]),[]);
});

test('unregistered exact references work and a refreshed word dictionary supplies the newly added translations',()=>{
  const current=sentences[7],missing=resolveSentenceWords(current,words).rows[0];
  assert.equal(missing.english,'');
  assert.deepEqual(findSentenceWordExamples(missing,words,sentences,current),[{korean:'볼 수 있어요.',japanese:'見られます。'}]);
  assert.deepEqual(findSentenceWordExamples(resolveSentenceWords(sentences[9],words).rows[0],words,sentences,sentences[9]),[]);
  const blank=parseDeck('vocabulary','id,韓国語,英語,日本語\n1,쓰다,write,書く\n70002,,ability,〜できる').cards;
  assert.equal(blank.some(word=>word.sourceId==='70002'),false);
  const updated=[...words,...parseDeck('vocabulary','id,韓国語,英語,日本語\n70002,수,ability; possibility,〜できる').cards];
  const row=resolveSentenceWords(current,updated).rows[0];
  assert.equal(row.words[0].sourceId,'70002');
  assert.equal(row.english,'ability; possibility');
  assert.equal(row.japanese,'〜できる');
  assert.deepEqual(findSentenceWordExamples(row,updated,sentences,current),[{korean:'볼 수 있어요.',japanese:'見られます。'}]);
});

test('word tables show lemma English Japanese and create escaped example content only on expansion',()=>{
  const current=sentences[0];
  const html=renderSentenceWords(current,words,sentences);
  assert.ok(html.includes('<th scope="col">原形</th><th scope="col">英語</th><th scope="col">日本語</th>'));
  assert.ok(html.includes('data-sentence-word-index="0"'));
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('class="sentence-example-row" hidden'));
  assert.ok(!html.includes('メモを書きます。'));
  assert.ok(!html.includes('メイン'));
  const expanded=renderSentenceWordExamples(current,words,sentences,0);
  assert.ok(expanded.includes('メモを書きます。'));
  assert.ok(expanded.includes('편지를 써요.'));
  assert.ok(!expanded.includes('苦い'));
  assert.equal(renderSentenceWordExamples(current,words,sentences,99),'');
  const unsafe=[{...words[0],exampleKo:'<script> & 문장',exampleJp:'<img src=x>'}];
  const safe=renderSentenceWordExamples(current,unsafe,[],0);
  assert.ok(safe.includes('&lt;script&gt; &amp; 문장'));
  assert.ok(safe.includes('&lt;img src=x&gt;'));
  assert.ok(!safe.includes('<script>'));
});
