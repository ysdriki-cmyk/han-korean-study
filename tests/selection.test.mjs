import test from 'node:test';
import assert from 'node:assert/strict';
import {getRecord} from '../dist/assets/learning.js';
import {recordAssessment} from '../dist/assets/assessment.js';
import {applyReviewSchedule} from '../dist/assets/review.js';
import {practiceSettings, practicePool, practiceCount, lastPracticeAt, makePracticeSession, restorePracticePreferences} from '../dist/assets/practice.js';

const NOW = Date.parse('2026-10-26T01:00:00Z'), DAY = 86400000;
const card = id => ({id:`vocabulary:${id}`,deckId:'vocabulary',han:'가',kanji:'行く'});
const graded = (target, mode, rating, at = NOW, correct = null) => applyReviewSchedule(recordAssessment(getRecord(target),mode,rating,{now:at,correct}),mode,rating,at);

test('the thirty-card limit is applied after prioritizing zero recorded attempts', () => {
  const fresh = Array.from({length:40},(_,i)=>card(`new${i}`));
  const frequent = Array.from({length:35},(_,i)=>card(`old${i}`));
  const source = [...frequent,...fresh];
  const records = Object.fromEntries(frequent.map(item=>[item.id,{assessments:{write:{attempts:20}}}]));
  const before = JSON.stringify({source,records});
  const result = makePracticeSession(source,records,practiceSettings(),{random:()=>0});
  assert.equal(result.length,30);
  assert.ok(result.every(item=>fresh.includes(item)));
  assert.equal(new Set(result.map(item=>item.id)).size,30);
  assert.equal(JSON.stringify({source,records}),before);
});

test('when new cards run out, fewer encounters fill the remaining slots in ascending order', () => {
  const source = [card('many'),card('two'),card('fresh'),card('oneA'),card('oneB')];
  const records = Object.fromEntries(source.filter(item=>!item.id.endsWith('fresh')).map(item=>[item.id,{assessments:{write:{attempts:({many:30,two:2,oneA:1,oneB:1})[item.id.split(':')[1]]}}}]));
  const result = makePracticeSession(source,records,practiceSettings({limit:'all',shuffle:false}));
  assert.deepEqual(result.map(item=>practiceCount(item,records,'write')),[0,1,1,2,30]);
  assert.deepEqual(result.slice(1,3).map(item=>item.id),['vocabulary:oneA','vocabulary:oneB']);
  const random = makePracticeSession(source,records,{mode:'write',limit:2,shuffle:true},{random:()=>0});
  assert.deepEqual(random.map(item=>item.id),['vocabulary:fresh','vocabulary:oneB']);
});

test('an unanswered reveal is one encounter and never outranks an untouched card', () => {
  const seen = card('seen'), fresh = card('fresh');
  const records = {[seen.id]:graded(seen,'write','unseen')};
  assert.equal(practiceCount(seen,records,'write'),1);
  assert.equal(records[seen.id].assessments.write.wrong,0);
  assert.equal(makePracticeSession([seen,fresh],records,{mode:'write',limit:1,shuffle:false})[0],fresh);
});

test('counts retain known legacy encounters without leaking across modes or decks', () => {
  const target = card('1'), other = {...target,id:'kanji:1',deckId:'kanji'};
  const records = {[target.id]:{assessments:{write:{attempts:2},read:{attempts:4}},attempts:{'han-ko':{right:3,wrong:1},'ko-han':{right:1,wrong:0}},writing:{attempts:1},reading:{attempts:0}}};
  assert.equal(practiceCount(target,records,'write'),7);
  assert.equal(practiceCount(target,records,'read'),5);
  assert.equal(practiceCount(other,records,'write'),0);
  assert.equal(practiceCount({...target,id:'vocabulary:source-only',state:'read2'},records,'write'),0);
});

test('explicit review admits a recent miss immediately while normal practice still waits 48 hours', () => {
  const target = card('miss'), fresh = card('new'), other = {...target,id:'kanji:miss',deckId:'kanji'};
  const records = {[target.id]:graded(target,'write','again',NOW,false)};
  const normal = practiceSettings();
  const review = practiceSettings({...normal,sessionType:'review'});
  assert.deepEqual(practicePool([target,fresh],records,normal,NOW),[fresh]);
  assert.deepEqual(practicePool([target,fresh],records,review,NOW),[target]);
  assert.deepEqual(practicePool([target,other],records,{...review,mode:'read'},NOW),[]);
  assert.equal(practicePool([target],records,normal,NOW+2*DAY).length,1);
  assert.equal(records[target.id].assessments.write.attempts,1);
});

test('recent review includes all ratings and honors its own time window and scope', () => {
  const recent = card('good'), old = card('old'), future = card('future'), unknown = card('undated');
  const records = {
    [recent.id]:graded(recent,'write','good',NOW,true),
    [old.id]:graded(old,'write','solid',NOW-8*DAY,true),
    [future.id]:graded(future,'write','good',NOW+DAY,true),
    [unknown.id]:{rank:'read2'},
  };
  const settings = practiceSettings({sessionType:'review',ratings:[],includeDue:false,excludeRecentDays:30,recentMistakesDays:7});
  assert.deepEqual(practicePool([recent,old,future,unknown],records,settings,NOW),[recent]);
  assert.deepEqual(practicePool([recent,old],records,{...settings,reviewDays:0},NOW),[recent,old]);
  assert.equal(lastPracticeAt(unknown,records,'write'),null);
  const kanji = {...recent,id:'kanji:empty',deckId:'kanji',kanji:''};
  const kanjiRecords = {[kanji.id]:graded(kanji,'write','again',NOW,false)};
  assert.equal(practicePool([kanji],kanjiRecords,settings,NOW).length,0);
  assert.equal(practicePool([kanji],kanjiRecords,{...settings,scope:'all'},NOW).length,1);
  assert.equal(practicePool([recent],records,{...settings,reviewDays:1},NOW+DAY).length,1);
  assert.equal(practicePool([recent],records,{...settings,reviewDays:1},NOW+DAY+1).length,0);
});

test('review selection does not weight frequent cards more heavily, or mutate the normal schedule', () => {
  const once = card('once'), many = card('many');
  const record = graded(many,'write','again',NOW,false);
  record.assessments.write.attempts = 40;
  const records = {[once.id]:graded(once,'write','again',NOW,false),[many.id]:record};
  const before = JSON.stringify(records);
  const settings = practiceSettings({sessionType:'review'});
  assert.equal(makePracticeSession(practicePool([many,once],records,settings,NOW),records,{...settings,limit:1})[0],once);
  assert.equal(JSON.stringify(records),before);
  assert.equal(practicePool([many,once],records,{...settings,sessionType:'practice'},NOW).length,0);
});

test('saved review choices survive reload and existing v4 defaults remain normal practice', () => {
  const legacy = {version:4,deckId:'kanji',courses:{kanji:{mode:'read',limit:'50'}}};
  const preferences = restorePracticePreferences(legacy);
  assert.equal(preferences.courses.kanji.sessionType,'practice');
  assert.equal(preferences.courses.kanji.mode,'read');
  preferences.courses.kanji = practiceSettings({...preferences.courses.kanji,sessionType:'review',reviewDays:1});
  assert.deepEqual(restorePracticePreferences(JSON.parse(JSON.stringify(preferences))),preferences);
  assert.equal(practiceSettings({reviewDays:null}).reviewDays,7);
});
