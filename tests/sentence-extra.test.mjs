import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDeck} from '../dist/assets/decks.js';
import {isExtraSentence,sentenceCollectionCards} from '../dist/assets/sentence-collections.js';
import {buildStudySets,cardsForStudySet,setProgress} from '../dist/assets/study-sets.js';
import {renderStudyHome} from '../dist/assets/study-home.js';

const cards=parseDeck('sentence','id_sentence,例文_韓国語,例文_日本語,ジャンル\n1,안녕,こんにちは,#交流\nsubtitle_001_0001,잘 지내요,元気です,#subtitle\nsubtitle_001_0002,가요,行きます,#subtitle #交流\n2,먹어요,食べます,#食事').cards;
const ids=rows=>rows.map(card=>card.sourceId);

test('subtitle is an exact tag and never inferred from text or card ID',()=>{
  assert.ok(isExtraSentence(cards[1]));
  assert.ok(isExtraSentence({...cards[0],tags:'＃ＳＵＢＴＩＴＬＥ'}));
  assert.equal(isExtraSentence({...cards[1],tags:'#subtitles'}),false);
  assert.equal(isExtraSentence({...cards[1],tags:'',notes:'#subtitle'}),false);
  assert.deepEqual(sentenceCollectionCards(cards,'unknown'),[]);
});

test('normal all, tags, custom all and saved word projections exclude extra sentences',()=>{
  const normal=buildStudySets('sentence',cards);
  assert.deepEqual(ids(cardsForStudySet(cards,normal[0])),['1','2']);
  assert.deepEqual(normal.map(set=>set.label),['すべて','交流','食事']);
  assert.deepEqual(ids(cardsForStudySet(cards,normal[1])),['1']);
  const sheetAll={id:'custom:sheet:all',label:'全件',deckId:'sentence',kind:'all',source:'sheet',sourceId:'all',order:0};
  assert.deepEqual(ids(cardsForStudySet(cards,sheetAll)),['1','2']);
  const subtitleRule={id:'custom:sub',label:'字幕',deckId:'sentence',kind:'custom',match:'all',rules:[{field:'tags',operator:'tag',value:'subtitle'}]};
  assert.deepEqual(cardsForStudySet(cards,subtitleRule),[]);
  assert.equal(setProgress(cardsForStudySet(cards,normal[0]),{},'read').total,2);
});

test('extra explicitly selects only subtitle cards and shares their stable learning IDs',()=>{
  const extra=buildStudySets('sentence',cards,[],{collection:'extra'});
  assert.deepEqual(ids(cardsForStudySet(cards,extra[0])),['subtitle_001_0001','subtitle_001_0002']);
  assert.deepEqual(ids(cardsForStudySet(cards,extra.find(set=>set.label==='交流'))),['subtitle_001_0002']);
  const records={[cards[1].id]:{assessments:{read:{rating:'good',attempts:1},write:{rating:'hard',attempts:1}}}};
  assert.equal(setProgress(cardsForStudySet(cards,extra[0]),records,'read').counts.good,1);
  assert.equal(setProgress(cardsForStudySet(cards,extra[0]),records,'write').counts.hard,1);
  assert.equal(setProgress(sentenceCollectionCards(cards,'core'),records,'read').counts.good,0);
  assert.deepEqual(cardsForStudySet(cards,{...extra[0],collection:'invalid'}),[]);
});

test('home exposes an extra box within sentence and a clear way back without a fourth course',()=>{
  const courses=[{id:'sentence',label:'sentence',count:772}];
  const core=renderStudyHome({courses,activeDeck:'sentence',extraProgress:{total:700}});
  assert.ok(core.includes('data-sentence-collection="extra"'));
  assert.ok(core.includes('extra 追加の例文、700枚'));
  assert.equal((core.match(/data-home-deck=/gu)||[]).length,1);
  const extra=renderStudyHome({courses,activeDeck:'sentence',sentenceCollection:'extra',extraProgress:{total:700}});
  assert.ok(extra.includes('data-sentence-collection="core"'));
  assert.ok(extra.includes('extraの演習を開始する'));
  assert.ok(extra.includes('extra<span>のセット'));
  const empty=renderStudyHome({courses,activeDeck:'sentence',extraProgress:{total:0}});
  assert.ok(empty.includes('data-sentence-collection="extra" disabled'));
});
