import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../dist/assets/decks.js';
import { resolveSentenceWords } from '../dist/assets/sentences.js';
import { findSentenceWordExamples } from '../dist/assets/sentence-examples.js';
import { renderSentenceWords,renderSentenceWordSheet,sentenceWordEntries,sentenceWordExamplePage } from '../dist/assets/sentence-view.js';
import { applyBulkRating } from '../dist/assets/bulk-rating.js';
import { recordAssessment, ratingFor } from '../dist/assets/assessment.js';
import { getRecord } from '../dist/assets/learning.js';

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

test('compact word tables keep English and examples in a separate escaped sheet',()=>{
  const current=sentences[0];
  const html=renderSentenceWords(current,words);
  assert.ok(html.includes('<th scope="col">原形</th><th scope="col">日本語</th>'));
  assert.ok(html.includes('data-sentence-word-open="0"'));
  assert.ok(html.includes('aria-haspopup="dialog"'));
  assert.ok(!html.includes('lang="en"'));
  assert.ok(!html.includes('sentence-example-row'));
  assert.ok(!html.includes('メモを書きます。'));
  assert.ok(!html.includes('メイン'));
  const row=sentenceWordEntries(current,words)[0];
  const expanded=renderSentenceWordSheet(row,words,sentences,current,{},'read');
  assert.ok(expanded.includes('メモを書きます。'));
  assert.ok(expanded.includes('편지를 써요.'));
  assert.ok(expanded.includes('lang="en">write'));
  assert.ok(!expanded.includes('苦い'));
  const unsafe=[{...words[0],exampleKo:'<script> & 문장',exampleJp:'<img src=x>'}];
  const safe=renderSentenceWordSheet(sentenceWordEntries(current,unsafe)[0],unsafe,[],current,{},'read');
  assert.ok(safe.includes('&lt;script&gt; &amp; 문장'));
  assert.ok(safe.includes('&lt;img src=x&gt;'));
  assert.ok(!safe.includes('<script>'));
});

test('all examples remain accessible in bounded pages, including the final partial page',()=>{
  const current=sentences[0],row=sentenceWordEntries(current,words)[0];
  const many=Array.from({length:39},(_,n)=>({...sentences[2],id:`sentence:${n}`,han:`문장 ${n}.`,kanji:`例文${n}`}));
  const pages=Array.from({length:20},(_,page)=>sentenceWordExamplePage(row,words,many,current,page));
  assert.equal(pages[0].total,40);
  assert.equal(pages[0].pages,20);
  assert.ok(pages.every(page=>page.examples.length===2));
  assert.equal(new Set(pages.flatMap(page=>page.examples.map(example=>example.korean))).size,40);
  assert.equal(sentenceWordExamplePage(row,words,many,current,999).page,19);
  assert.equal(sentenceWordExamplePage(row,words,many,current,-2).page,0);
  const partial=sentenceWordExamplePage(row,words,many.slice(1),current,19);
  assert.equal(partial.examples.length,1);
  const empty=sentenceWordExamplePage(null,words,[],current);
  assert.deepEqual(empty,{examples:[],total:0,page:0,pages:1});
});

test('homonyms have individual statuses and missing words cannot write vocabulary records',()=>{
  const ambiguous={...sentences[0],sentenceRefs:[{position:1,korean:'쓰다'}]};
  const entries=sentenceWordEntries(ambiguous,words);
  assert.equal(entries.length,2);
  assert.deepEqual(entries.map(row=>row.word.id),['vocabulary:1','vocabulary:2']);
  assert.notEqual(entries[0].key,entries[1].key);
  const old='2026-11-01T01:00:00Z';
  const record=recordAssessment(recordAssessment(getRecord(words[0]),'read','again',{correct:false,now:old}),'write','solid',{correct:true,now:old});
  record.assessments.read.dueAt='2026-11-20T00:00:00Z';
  const records={'vocabulary:1':record,'sentence:current':{custom:'sentence history'},'vocabulary:2':{custom:'other sense'}};
  const before=JSON.stringify(records);
  const edited=applyBulkRating([entries[0].word],records,[entries[0].word.id],'read','good','2026-11-13T00:00:00Z').records;
  assert.equal(ratingFor(words[0],edited,'read'),'good');
  assert.equal(ratingFor(words[0],edited,'write'),'solid');
  assert.deepEqual(edited['sentence:current'],records['sentence:current']);
  assert.deepEqual(edited['vocabulary:2'],records['vocabulary:2']);
  for(const field of ['attempts','correct','wrong','lastAt','history','dueAt'])assert.deepEqual(edited['vocabulary:1'].assessments.read[field],record.assessments.read[field]);
  assert.equal(JSON.stringify(records),before);
  assert.match(renderSentenceWords(ambiguous,words,edited,'write'),/単語 · 쓰기/);
  assert.match(renderSentenceWords(ambiguous,words,edited,'write'),/쓰기 ◎ 完璧/);
  const missing=renderSentenceWords(sentences[7],words);
  assert.match(missing,/data-sentence-word-status="0"[^>]* disabled/);
  assert.match(missing,/data-sentence-word-open="0"/);
});
