import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseVariationContent } from '../dist/assets/variation-content.js';
import { parseDeck } from '../dist/assets/decks.js';
import { linkSentenceWords } from '../dist/assets/sentences.js';
import { renderSentenceWords, sentenceWordEntries, renderSentenceWordSheet } from '../dist/assets/sentence-view.js';
import { buildVariationLessons } from '../dist/assets/variations.js';
import { renderVariationPrompt, renderVariationAnswer } from '../dist/assets/variation-view.js';

const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const csv = (headers, rows) => [headers,...rows.map(row => headers.map(header => row[header] ?? ''))].map(row => row.map(quote).join(',')).join('\n');
const vocabulary = [
  ['1','어제','yesterday','昨日'], ['2','친구','friend','友達'], ['3','만나다','meet','会う'],
  ['4','같이','together','一緒に'], ['5','작다','small','小さい'], ['6','식당','restaurant','食堂'],
  ['7','김밥','gimbap','キンパ'], ['8','맛있다','delicious','おいしい'], ['9','먹다','eat','食べる'], ['10','오다','come','来る'],
];
const words = parseDeck('vocabulary', [
  ['id','韓国語','英語','日本語','例文_韓国語','例文_日本語'],
  ...vocabulary.map(row => [...row,...(row[0] === '9' ? ['아침을 먹어요.','朝ごはんを食べます。'] : ['',''])]),
].map(row => row.map(quote).join(',')).join('\n')).cards;
const sample = {
  id_sentence:'variation-word-test',セットID:'words-1',セット名:'友達と食べて帰った',順番:'1',
  例文_韓国語:'어제 친구를 만나 같이 작은 식당에서 김밥을 맛있게 먹고 왔어요.',
  例文_日本語:'昨日友達に会い、一緒に小さな食堂でキンパをおいしく食べて帰ってきました。',
  使用韓国語_main:'먹다',使用単語ID_main:'9',
  ...Object.fromEntries(vocabulary.map((row,index) => [`使用韓国語_${index + 1}`,row[1]])),
};
const columns = ['id_sentence','例文_韓国語','例文_日本語','セットID','セット名','順番','使用韓国語_main','使用単語ID_main',
  ...[10,2,1,8,3,9,4,6,5,7].map(index => `使用韓国語_${index}`)];
const parsed = parseVariationContent(csv(columns,[sample]));
const [card] = linkSentenceWords(parsed.cards,words).cards;
const records = {'vocabulary:9':{assessments:{read:{rating:'good',attempts:2},write:{rating:'again',attempts:1}}},
  [card.id]:{assessments:{write:{rating:'solid',attempts:3}}}};

test('dedicated variation numbered word columns use the shared ordered vocabulary controls through the tenth word', () => {
  assert.deepEqual(card.sentenceRefs.map(ref => ref.position),[1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(card.sourceWords.map(word => word.id),vocabulary.map(row => `vocabulary:${row[0]}`));
  assert.equal(card.mainWord.id,'vocabulary:9');
  const entries = sentenceWordEntries(card,words);
  assert.deepEqual(entries.map(row => row.lemma),vocabulary.map(row => row[1]));
  assert.deepEqual(entries.filter(row => row.main).map(row => row.lemma),['먹다']);
  const before = JSON.stringify(records);
  const html = renderSentenceWords(card,words,records,'write');
  assert.match(html,/使用単語/u);
  assert.match(html,/data-sentence-word-open="9"/u);
  assert.match(html,/data-sentence-word-status="9"/u);
  assert.match(html,/먹다の単語ステータス：쓰기 ❌ もう一度/u);
  assert.doesNotMatch(html,/lang="en"/u);
  assert.equal(JSON.stringify(records),before);
});

test('variation words open the ordinary meaning, audio, rating and related-example panel', () => {
  const other = parseDeck('sentence','id_sentence,例文_韓国語,例文_日本語,使用韓国語_1\nother,여기서 김밥을 먹어요.,ここでキンパを食べます。,먹다').cards;
  const entry = sentenceWordEntries(card,words).find(row => row.lemma === '먹다');
  const html = renderSentenceWordSheet(entry,words,[card,...other],card,records,'write');
  assert.match(html,/id="sentence-word-title" lang="ko">먹다/u);
  assert.match(html,/lang="ja">食べる/u);
  assert.match(html,/lang="en">eat/u);
  assert.match(html,/data-speak="먹다"/u);
  assert.match(html,/data-word-sheet-mode="read"/u);
  assert.match(html,/data-word-sheet-rating="again"[^>]*aria-pressed="true"/u);
  assert.match(html,/아침을 먹어요\./u);
  assert.match(html,/여기서 김밥을 먹어요\./u);
  assert.doesNotMatch(html,new RegExp(card.han.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&'),'u'));
});

test('numbered variation words may be filled gradually while blank slots remain absent', () => {
  const partial = {...sample};
  for (let index=3;index<=10;index++) partial[`使用韓国語_${index}`]='';
  const [growing] = parseVariationContent(csv(columns,[partial])).cards;
  assert.deepEqual(growing.sentenceRefs.map(ref => ref.korean),['어제','친구']);
  const html = renderSentenceWords(growing,words);
  assert.equal((html.match(/data-sentence-word-open=/gu)||[]).length,2);
  assert.match(html,/今回の単語：<strong lang="ko">먹다/u);
});

test('the actual variation study card reveals word controls only after the answer', () => {
  const source = readFileSync(new URL('../dist/assets/app.js',import.meta.url),'utf8');
  const start = source.indexOf('function renderCard() {');
  const render = source.slice(start,source.indexOf('\nfunction renderComplete(',start));
  assert.ok(start>=0 && render.includes('renderSentenceWords'));
  const element = {innerHTML:'',dataset:{},setAttribute(){},classList:{toggle(){}}};
  const context = vm.createContext({
    speaker:{stop(){}},sentenceWordSheet:{refresh(){}},$:()=>element,loaded:true,cards:[card],session:[card],position:0,
    settings:{mode:'write'},revealed:false,answers:new Map(),sessionLesson:buildVariationLessons([card])[0],
    activeDeck:'sentence',submitted:'',writeResult:null,sentenceWordMode:null,records,
    deckData:new Map([['vocabulary',{cards:words}]]),inConversation:()=>false,inVariation:()=>true,
    rank:()=> 'solid',badge:()=>'',icon:()=>'',cardNavigation:()=>'',assessmentButtons:()=>'',
    questionMarkup:()=>`<p>${card.kanji}</p>`,answerRows:()=>card.han,
    esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
    renderVariationPrompt,renderVariationAnswer,renderSentenceWords,
  });
  vm.runInContext(`${render}\nrenderCard();`,context);
  assert.doesNotMatch(element.innerHTML,/data-sentence-word-(?:open|status)=/u);
  assert.doesNotMatch(element.innerHTML,/使用単語/u);
  assert.doesNotMatch(element.innerHTML,/lang="ko">어제/u);
  context.revealed=true;
  vm.runInContext('renderCard();',context);
  assert.match(element.innerHTML,/data-sentence-word-open="9"/u);
  assert.match(element.innerHTML,/使用単語/u);
});
