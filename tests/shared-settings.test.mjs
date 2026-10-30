import test from 'node:test';
import assert from 'node:assert/strict';
import { restorePracticePreferences, sharedPracticeSettings, applyPracticeSettings } from '../dist/assets/practice.js';

test('common criteria align every course while directions and session context stay independent', () => {
  const source = restorePracticePreferences(null);
  source.deckId = 'sentence';
  source.courses.kanji.scope = 'essential';
  source.courses.vocabulary.sessionType = 'review';
  source.courses.sentence.libraryDirection = 'han-ko';
  source.selectedSet = 'example-set';
  const before = JSON.stringify(source);
  const updated = applyPracticeSettings(source, {
    mode:'write',sessionType:'practice',scope:'all',libraryDirection:'ko-han',
    ratings:['again','unsure'],limit:'50',shuffle:false,includeDue:false,recentMistakesDays:14,excludeRecentDays:7,reviewDays:30,
  });
  for (const id of ['kanji','vocabulary','sentence']) {
    assert.deepEqual(sharedPracticeSettings(updated.courses[id]), updated.commonPractice);
    assert.equal(updated.courses[id].mode, source.courses[id].mode);
    assert.equal(updated.courses[id].sessionType, source.courses[id].sessionType);
    assert.equal(updated.courses[id].scope, source.courses[id].scope);
    assert.equal(updated.courses[id].libraryDirection, source.courses[id].libraryDirection);
    assert.equal(updated.courses[id].filter, 'all');
  }
  assert.equal(updated.courses.vocabulary.limit,'50');
  assert.equal(updated.courses.vocabulary.shuffle,false);
  assert.equal(updated.deckId,'sentence');
  assert.equal(updated.selectedSet,'example-set');
  assert.equal(JSON.stringify(source),before);
  assert.deepEqual(restorePracticePreferences(JSON.parse(JSON.stringify(updated))),updated);
  updated.courses.kanji.ratings.push('solid');
  assert.deepEqual(updated.courses.sentence.ratings,['again','unsure']);
  assert.deepEqual(updated.commonPractice.ratings,['again','unsure']);
});

test('individual edits leave other courses and the common template unchanged; a later common save aligns them again', () => {
  const common = applyPracticeSettings(restorePracticePreferences(null), {limit:'20',shuffle:false,ratings:['unseen']});
  const before = JSON.stringify(common);
  const individual = applyPracticeSettings(common, {limit:'10',ratings:['hard','again'],shuffle:true}, {target:'course',deckId:'sentence'});
  assert.deepEqual(individual.courses.kanji,common.courses.kanji);
  assert.deepEqual(individual.courses.vocabulary,common.courses.vocabulary);
  assert.deepEqual(individual.commonPractice,common.commonPractice);
  assert.equal(individual.courses.sentence.limit,'10');
  assert.equal(individual.courses.sentence.mode,'read');
  assert.equal(JSON.stringify(common),before);
  const reloaded = restorePracticePreferences(JSON.parse(JSON.stringify(individual)));
  assert.equal(reloaded.courses.sentence.limit,'10');
  const aligned = applyPracticeSettings(reloaded, {limit:'30',shuffle:true,ratings:[]});
  for (const course of Object.values(aligned.courses)) {
    assert.equal(course.limit,'30');
    assert.deepEqual(course.ratings,[]);
  }
});

test('shared criteria whitelist basic fields and normalize values without accepting a direction or set', () => {
  const basic = sharedPracticeSettings({limit:999,shuffle:false,reviewDays:2,ratings:['unseen','invalid'],mode:'write',scope:'all',selectedSet:'all'});
  assert.deepEqual(basic, {ratings:['unseen'],limit:'30',shuffle:false,includeDue:true,recentMistakesDays:0,excludeRecentDays:0,reviewDays:7});
  assert.throws(()=>applyPracticeSettings(null,{}, {target:'unknown'}),/適用先/);
  assert.throws(()=>applyPracticeSettings(null,{}, {target:'course',deckId:'unknown'}),/適用先/);
});
