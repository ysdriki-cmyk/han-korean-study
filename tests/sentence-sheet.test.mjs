import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck, restoreLearningRecords } from '../dist/assets/decks.js';
import { resolveSentenceWords, linkSentenceWords, sentenceWordIssues } from '../dist/assets/sentences.js';
import { renderSentenceWords } from '../dist/assets/sentence-view.js';
import { makePracticeSession, sentenceMainWordStudied } from '../dist/assets/practice.js';
import { recordAssessment } from '../dist/assets/assessment.js';
import { getRecord } from '../dist/assets/learning.js';
import { buildStudySets, cardsForStudySet } from '../dist/assets/study-sets.js';
import { parseCategorySheet } from '../dist/assets/category-sheet.js';
import { inspectContent } from '../dist/assets/admin-data.js';

const words=parseDeck('vocabulary','id,韓国語,日本語,英語\n1015,얼굴,顔,face\n352,다,全部,all\n922,쓰다,書く,write\n1244,있다,ある・いる,be\n9,쓰다,苦い,bitter').cards;
const header='id_sentence,例文_韓国語,例文_日本語,使用韓国語_main,使用韓国語_3,使用韓国語_1,使用韓国語_4,使用韓国語_2,使用単語ID_main,使用単語ID_3,文中表記_1,文中表記_3,文中表記_4,文中訳_1,文中訳_3,文中訳_4,備考,ジャンル';
const csv=header+'\ns_1,얼굴에 다 써 있어요.,顔に全部書いてあります。,쓰다,쓰다,얼굴,있다,다,922,922,얼굴에,써,있어요,顔に,書いて,あります（状態が続いている）,非表示メモ,#会話';

test('dedicated sentence columns sort by number while main remains independent', () => {
  const {cards,warnings}=parseDeck('sentence',csv);
  assert.deepEqual(warnings,[]);
  assert.equal(cards[0].id,'sentence:s_1');
  assert.deepEqual(cards[0].sentenceRefs.map(ref=>[ref.position,ref.korean]),[[1,'얼굴'],[2,'다'],[3,'쓰다'],[4,'있다']]);
  const before=JSON.stringify(cards);
  const result=resolveSentenceWords(cards[0],words);
  assert.deepEqual(result.rows.map(row=>row.surface),['얼굴에','다','써','있어요']);
  assert.deepEqual(result.rows.map(row=>row.lemma),['얼굴','다','쓰다','있다']);
  assert.deepEqual(result.rows.map(row=>row.main),[false,false,true,false]);
  assert.equal(result.rows[2].japanese,'書いて');
  assert.equal(result.main.words[0].id,'vocabulary:922');
  assert.deepEqual(result.issues,[]);
  assert.equal(JSON.stringify(cards),before);
  const html=renderSentenceWords(cards[0],words);
  assert.ok(html.includes('<th scope="col">韓国語</th><th scope="col">原形</th><th scope="col">日本語'));
  assert.equal((html.match(/class="sentence-main-row"/g)||[]).length,1);
  assert.ok(html.indexOf('얼굴에') < html.indexOf('써'));
  assert.ok(!html.includes('非表示メモ'));
  assert.ok(!html.includes('bitter'));
});

test('additional numbered columns, NFC, missing slots and fixed identities are supported', () => {
  const input='id_sentence,例文_韓国語,例文_日本語,使用韓国語_１１,使用韓国語_2,使用韓国語_main\n2,다 써요,全部書きます,다,쓰다,다';
  const [card]=parseDeck('sentence',input).cards;
  assert.deepEqual(card.sentenceRefs.map(ref=>ref.position),[2,11]);
  assert.equal(card.sentenceRefs[1].korean,'다');
  assert.equal(parseDeck('sentence',input.replace('全部書きます','修正した訳')).cards[0].id,card.id);
  assert.throws(()=>parseDeck('sentence',input+'\n2,別,別,다,쓰다,다'),/重複/);
  assert.throws(()=>parseDeck('sentence','例文_韓国語,例文_日本語\n다,全部'),/id_sentence/);
  assert.throws(()=>parseDeck('sentence','id_sentence,例文_韓国語,例文_日本語,使用韓国語_1,使用韓国語_１\n1,다,全部,다,다'),/重複/);
  assert.equal(parseDeck('sentence','id_sentence,例文_韓国語,例文_日本語\n1,다,\n2,,全部').cards.length,0);
  const stored=restoreLearningRecords({version:3,records:{'sentence:2':{assessments:{read:{rating:'good',attempts:2}}}}});
  assert.equal(stored[card.id].assessments.read.attempts,2);
});

test('missing words remain visible and are recorded once with all sentence references', () => {
  const sentences=parseDeck('sentence','id_sentence,例文_韓国語,例文_日本語,使用韓国語_main,使用韓国語_1\n1,없는 말,未知語,미등록어,미등록어\n2,없는 말2,未知語2,,미등록어').cards;
  const issues=sentenceWordIssues(sentences,words);
  assert.equal(issues.length,1);
  assert.equal(issues[0].reason,'単語が未登録');
  assert.deepEqual(issues[0].references,['1:使用韓国語_1','1:使用韓国語_main','2:使用韓国語_1']);
  assert.ok(renderSentenceWords(sentences[0],words).includes('미등록어'));
  assert.ok(renderSentenceWords(sentences[0],words).includes('—'));
  const mismatch=parseDeck('sentence','id_sentence,例文_韓国語,例文_日本語,使用韓国語_1,使用単語ID_1\n3,다,全部,다,1015').cards[0];
  assert.equal(sentenceWordIssues([mismatch],words)[0].reason,'韓国語とIDが不一致');
  const ambiguous=parseDeck('sentence','id_sentence,例文_韓国語,例文_日本語,使用韓国語_1\n4,써요,書きます,쓰다').cards[0];
  assert.equal(sentenceWordIssues([ambiguous],words)[0].reason,'同じ表記に複数候補');
  const differentSense=parseDeck('sentence','id_sentence,例文_韓国語,例文_日本語,使用韓国語_main,使用単語ID_main,使用韓国語_1,使用単語ID_1\n5,써요,書きます,쓰다,922,쓰다,9').cards[0];
  assert.equal(resolveSentenceWords(differentSense,words).rows[0].main,false);
});

test('sentence reference text is escaped and inflections are not guessed', () => {
  const card={sourceId:'x',mainKorean:'',sentenceRefs:[{position:1,korean:'써',surface:'<script>',translation:'<img src=x>'}]};
  assert.equal(resolveSentenceWords(card,words).rows[0].words.length,0);
  const html=renderSentenceWords(card,words);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
});

test('sentence genre sets use their own sheet and preserve main-word links', () => {
  const [card]=linkSentenceWords(parseDeck('sentence',csv).cards,words).cards;
  assert.equal(card.mainWord.id,'vocabulary:922');
  assert.equal(card.sourceWords.length,4);
  const sets=buildStudySets('sentence',[card]);
  assert.deepEqual(sets.map(set=>set.label),['すべて','会話']);
  assert.equal(cardsForStudySet([card],sets[1]).length,1);
  const parsed=parseCategorySheet('category_id,カテゴリ名,教材,対象列,条件,値,条件の結合,表示順\ns,会話,sentence,ジャンル,タグ一致,#会話,AND,1');
  assert.deepEqual(parsed.warnings,[]);
  assert.equal(cardsForStudySet([card],parsed.sets[0]).length,1);
  const schema=inspectContent('sentence',csv);
  assert.ok(schema.columns.find(col=>col.header==='使用韓国語_3').use.includes('文中順'));
});

test('studied main words win ties while lower sentence counts and filters retain precedence', () => {
  const [linked]=linkSentenceWords(parseDeck('sentence',csv).cards,words).cards;
  const other={...linked,id:'sentence:other',mainKorean:'얼굴',mainWord:words[0]};
  const unknown={...linked,id:'sentence:unknown',mainKorean:'미등록어',mainWord:null};
  const records={'vocabulary:922':recordAssessment(getRecord(words[2]),'read','unsure',{now:'2026-11-01T00:00:00Z'})};
  assert.equal(sentenceMainWordStudied(linked,records),true);
  assert.equal(sentenceMainWordStudied(other,records),false);
  assert.equal(sentenceMainWordStudied(unknown,records),false);
  assert.deepEqual(makePracticeSession([other,unknown,linked],records,{mode:'read',shuffle:false,limit:'all'}).map(card=>card.id),[linked.id,other.id,unknown.id]);
  records[linked.id]=recordAssessment(getRecord(linked),'read','good',{correct:true,now:'2026-11-01T00:00:00Z'});
  assert.equal(makePracticeSession([linked,other],records,{mode:'read',shuffle:false,limit:'all'})[0].id,other.id);
  assert.equal(records['vocabulary:922'].assessments.write,undefined);
});
