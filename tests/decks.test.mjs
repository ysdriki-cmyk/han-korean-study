import test from 'node:test';
import assert from 'node:assert/strict';
import {namespaceCards,restoreLearningRecords,answerFields} from '../dist/assets/decks.js';

test('the same source number cannot share learning records between courses',()=>{
  const raw=[{id:'277',han:'날'}];
  const [word]=namespaceCards(raw,'vocabulary');
  const [kanji]=namespaceCards(raw,'kanji');
  assert.equal(word.id,'vocabulary:277');assert.equal(kanji.id,'kanji:277');
  assert.equal(raw[0].id,'277');assert.equal(word.sourceId,'277');
  assert.throws(()=>namespaceCards(raw,'other'));
});
test('existing v2 records migrate only into kanji and preserve temporarily absent IDs',()=>{
  const previous={version:2,records:{'277':{rank:'mastered'},'removed':{rank:'fair'}}};
  const records=restoreLearningRecords(null,previous,null);
  assert.equal(records['kanji:277'].rank,'mastered');assert.equal(records['kanji:removed'].rank,'fair');
  assert.equal(records['vocabulary:277'],undefined);assert.equal(Object.getPrototypeOf(records),null);
});
test('v3 takes precedence over older storage and preserves both courses independently',()=>{
  const current={version:3,records:{'kanji:1':{rank:'fair'},'vocabulary:1':{rank:'read2'},'bad':{rank:'read2'}}};
  const result=restoreLearningRecords(current,{version:2,records:{'1':{rank:'mastered'}}},null);
  assert.equal(result['kanji:1'].rank,'fair');assert.equal(result['vocabulary:1'].rank,'read2');
  assert.equal(result.bad,undefined);
});
test('v1 direction-specific history is also scoped to the original kanji course',()=>{
  const result=restoreLearningRecords(null,null,{'ko-han:8':{status:'mastered'},'han-ko:8':{status:'review'}});
  assert.equal(result['kanji:8'].rank,'manji');assert.equal(result['vocabulary:8'],undefined);
});
test('vocabulary answers label Japanese and optional English without leaking example text',()=>{
  const card={kanji:'日',meaning:'day',english:'day',hanja:'',exampleKo:'좋은 날이에요',notes:'날'};
  assert.deepEqual(answerFields(card,'vocabulary'),[{label:'日本語',text:'日',lang:'ja'},{label:'英語',text:'day',lang:'en'}]);
  assert.equal(answerFields({...card,english:'',meaning:''},'vocabulary').length,1);
});
