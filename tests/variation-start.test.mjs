import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomVariationLesson, unpracticedVariationLessons } from '../dist/assets/variation-practice.js';
import { buildVariationLessons } from '../dist/assets/variations.js';
import { buildStudySets, cardsForStudySet } from '../dist/assets/study-sets.js';
import { ratingFor, recordAssessment } from '../dist/assets/assessment.js';
import { getRecord } from '../dist/assets/learning.js';
import { applyBulkRating } from '../dist/assets/bulk-rating.js';

const card=(group,order,category)=>({
  id:`sentence:${group}-${order}`,sourceId:`${group}-${order}`,deckId:'sentence',tags:'#variation',
  han:`${group} 문장 ${order}`,kanji:`${group}の文${order}`,
  variation:{groupId:group,order,title:`${group}の練習`,category,instruction:`${group}を変える`},
});
// Unequal family sizes and scrambled source rows catch card-weighted selection or shuffling.
const cards=[card('a',3,'食事'),card('c',2,'移動'),card('a',1,'食事'),card('b',1,'食事'),card('c',1,'移動'),card('a',2,'食事')];
const lessons=buildVariationLessons(cards);
const ids=items=>Array.from(items,item=>item.id);

test('random variation selection is uniform between complete sets regardless of their sentence counts',()=>{
  const before=JSON.stringify(lessons),counts=new Map(lessons.map(lesson=>[lesson.id,0]));
  for(let index=0;index<60;index++) {
    const chosen=randomVariationLesson(lessons,{random:()=>(index+.5)/60});
    assert.equal(chosen,lessons.find(lesson=>lesson.id===chosen.id));
    counts.set(chosen.id,counts.get(chosen.id)+1);
  }
  assert.deepEqual([...counts.values()],[20,20,20]);
  assert.equal(randomVariationLesson(lessons,{random:()=>0}),lessons[0]);
  assert.equal(randomVariationLesson(lessons,{random:()=>.5}),lessons[1]);
  assert.equal(randomVariationLesson(lessons,{random:()=>.999}),lessons[2]);
  assert.equal(JSON.stringify(lessons),before);
});

test('random starts avoid the last set when possible, reuse a sole candidate and reject empty inputs',()=>{
  assert.equal(randomVariationLesson(lessons,{excludeId:lessons[0].id,random:()=>0}),lessons[1]);
  assert.equal(randomVariationLesson(lessons,{excludeId:lessons[0].id,random:()=>.999}),lessons[2]);
  assert.equal(randomVariationLesson([lessons[0]],{excludeId:lessons[0].id,random:()=>0}),lessons[0]);
  assert.equal(randomVariationLesson(lessons,{excludeId:'variation:missing',random:()=>0}),lessons[0]);
  for(const invalid of [null,undefined,[],{},[null,{}, {cards:[]},{cards:null}]])assert.equal(randomVariationLesson(invalid),null);
  const mixed=[null,{cards:[]},lessons[1],{}];
  assert.equal(randomVariationLesson(mixed,{random:()=>.999}),lessons[1]);
});

test('unpracticed sets require every sentence to have zero actual attempts in the selected direction',()=>{
  const attempted=recordAssessment(getRecord(cards.find(item=>item.id==='sentence:a-2')),'read','unseen',{correct:null,now:'2026-11-17T00:00:00Z'});
  const records={
    'sentence:a-2':attempted,
    'sentence:b-1':{assessments:{write:{rating:'good',attempts:1}}},
    'sentence:c-2':{assessments:{read:{rating:'solid',attempts:0,ratingEditedAt:'2026-11-16T00:00:00Z'}}},
  };
  const before=JSON.stringify({lessons,records});
  assert.equal(attempted.assessments.read.rating,'unseen');
  assert.equal(attempted.assessments.read.attempts,1);
  assert.deepEqual(ids(unpracticedVariationLessons(lessons,records,'read')),['variation:b','variation:c']);
  assert.deepEqual(ids(unpracticedVariationLessons(lessons,records,'write')),['variation:a','variation:c']);
  assert.equal(unpracticedVariationLessons(lessons,records,'read')[0],lessons[1]);
  assert.equal(JSON.stringify({lessons,records}),before);
  for(const invalid of [null,undefined,[],{},[null,{}, {cards:[]},{cards:null}]])assert.deepEqual(unpracticedVariationLessons(invalid),[]);
});

test('manual rating edits do not count as practice, while recorded history without a counter does',()=>{
  const edited=applyBulkRating(cards,{},ids(cards),'read','solid','2026-11-17T00:00:00Z').records;
  const before=JSON.stringify(edited);
  assert.deepEqual(ids(unpracticedVariationLessons(lessons,edited,'read')),ids(lessons));
  assert.equal(JSON.stringify(edited),before);
  const historyOnly={...edited,'sentence:a-3':{assessments:{read:{rating:'unseen',history:[{correct:null,at:'2026-11-17T00:00:00Z'}]}}}};
  assert.deepEqual(ids(unpracticedVariationLessons(lessons,historyOnly,'read')),['variation:b','variation:c']);
  assert.deepEqual(ids(unpracticedVariationLessons(lessons,historyOnly,'write')),ids(lessons));
});

const appSource=readFileSync(new URL('../dist/assets/app.js',import.meta.url),'utf8');
function appFunction(name) {
  const start=appSource.indexOf(`function ${name}(`);
  assert.ok(start>=0,`Missing application function ${name}`);
  const end=appSource.indexOf('\nfunction ',start+1);
  return appSource.slice(start,end<0?undefined:end);
}

/** Execute the actual app handlers, while keeping rendering and storage outside this unit. */
function application({query='',group='all',sample=.999,availableIds=null,recordState={}}={}) {
  let randomSample=sample,spoken=0;
  const choices=[],preferenceWrites=[],search={value:'existing search'};
  const sets=buildStudySets('sentence',cards,[],{collection:'variation'}).filter(set=>!availableIds || availableIds.includes(set.id));
  const records=structuredClone(recordState);
  const before=JSON.stringify(records);
  const context=vm.createContext({
    activeDeck:'sentence',sentenceCollection:'variation',homeQuery:query,homeGroup:group,
    cards,deckData:new Map([['sentence',{cards}]]),records,
    settings:{mode:'read',sessionType:'review',scope:'essential',shuffle:true,limit:'1',ratings:['unseen']},
    selectedSetIds:{sentence:''},lastVariationLessonId:'',lastConversationLessonId:'',view:'home',
    selected:new Set(),revealedRows:new Set(),rankFilter:'all',page:0,
    session:[],sessionCards:[],sessionLesson:null,sentenceWordMode:null,composing:false,compositionEndedAt:0,
    initialCount:0,sessionScope:'all',hintSeeds:new Map(),position:0,revealed:false,writeResult:null,submitted:'',
    answers:new Map(),cardViews:new Map(),advancedPositions:new Set(),
    $:()=>search,
    buildVariationLessons,cardsForStudySet,unpracticedVariationLessons,
    availableStudySets:()=>sets,
    rank:item=>ratingFor(item,records,'read'),
    randomVariationLesson:(candidates,options)=>{
      choices.push({ids:ids(candidates),excludeId:options.excludeId});
      return randomVariationLesson(candidates,{...options,random:()=>randomSample});
    },
    savePreferences:()=>preferenceWrites.push(true),syncSettingsForm(){},updateCourseChrome(){},renderOverview(){},renderCard(){},
    sentenceWordSheet:{close(){}},kanjiPromptChoices:()=>[],
    speakQuestion:()=>{spoken++;},
    // Ordered lessons must never enter the ordinary card filtering/shuffling path.
    pool(){throw new Error('variation entered the ordinary practice pool');},
    makePracticeSession(){throw new Error('variation entered the shuffled session builder');},
  });
  const names=['inConversation','inVariation','allVariationLessons','variationSearchText','matchingVariationLessons',
    'defaultVariationSet','chooseStudySet','startRandomVariationLesson','startDefaultPractice','startSession'];
  vm.runInContext(`${names.map(appFunction).join('\n')}
    function activeStudySet(){return availableStudySets().find(set=>set.id===selectedSetIds.sentence);}
    function studyCards(){return cardsForStudySet(cards,activeStudySet());}
    function setView(next){view=next;}
    globalThis.handlers={startDefaultPractice,startRandomVariationLesson,chooseStudySet,startSession,matchingVariationLessons};`,context);
  return {context,handlers:context.handlers,choices,preferenceWrites,before,
    set sample(value){randomSample=value;},get spoken(){return spoken;},
  };
}

test('the actual start button randomly selects complete unpracticed sets and keeps base-to-derived order',()=>{
  const app=application({sample:.999});
  app.handlers.startDefaultPractice();
  assert.equal(app.context.selectedSetIds.sentence,'variation:c');
  assert.equal(app.context.lastVariationLessonId,'variation:c');
  assert.equal(app.context.view,'study');
  assert.deepEqual(ids(app.context.session),['sentence:c-1','sentence:c-2']);
  assert.equal(app.context.position,0);
  assert.equal(app.context.sessionLesson.baseCard.id,'sentence:c-1');
  assert.deepEqual(app.choices,[{ids:['variation:a','variation:b','variation:c'],excludeId:''}]);
  // The draw remains random at set level, with no sentence shuffle or one-card limit.
  app.sample=0;
  app.handlers.startDefaultPractice();
  assert.equal(app.context.selectedSetIds.sentence,'variation:a');
  assert.deepEqual(ids(app.context.session),['sentence:a-1','sentence:a-2','sentence:a-3']);
  assert.equal(app.choices.at(-1).excludeId,'variation:c');
  assert.equal(JSON.stringify(app.context.records),app.before);
  assert.equal(app.spoken,2);
});

test('the actual start button filters partial attempts by direction while keeping manually rated sets eligible',()=>{
  const recordState={
    'sentence:a-2':{assessments:{read:{rating:'unseen',attempts:1,history:[{correct:null,at:'2026-11-17T00:00:00Z'}]}}},
    'sentence:b-1':{assessments:{read:{rating:'solid',attempts:0,ratingEditedAt:'2026-11-16T00:00:00Z'}}},
    'sentence:c-1':{assessments:{write:{rating:'good',attempts:1}}},
  };
  const app=application({recordState,sample:.999});
  app.handlers.startDefaultPractice();
  assert.deepEqual(app.choices[0].ids,['variation:b','variation:c']);
  assert.equal(app.context.selectedSetIds.sentence,'variation:c');
  app.context.settings.mode='write';
  app.sample=0;
  app.handlers.startDefaultPractice();
  assert.deepEqual(app.choices[1].ids,['variation:a','variation:b']);
  assert.equal(app.context.selectedSetIds.sentence,'variation:a');
  assert.deepEqual(ids(app.context.session),['sentence:a-1','sentence:a-2','sentence:a-3']);
  assert.equal(JSON.stringify(app.context.records),app.before);
});

test('random starts respect the actual search/category/set boundaries without falling back to unrelated sets',()=>{
  const app=application({query:'ｂ',group:'食事',sample:0});
  app.context.lastVariationLessonId='variation:b';
  assert.deepEqual(ids(app.handlers.matchingVariationLessons()),['variation:b']);
  app.handlers.startDefaultPractice();
  assert.equal(app.context.selectedSetIds.sentence,'variation:b');
  assert.deepEqual(ids(app.context.session),['sentence:b-1']);
  app.context.homeGroup='移動';
  const selected=app.context.selectedSetIds.sentence,session=app.context.session,writes=app.preferenceWrites.length;
  app.handlers.startDefaultPractice();
  assert.deepEqual(app.choices.at(-1).ids,[]);
  assert.equal(app.context.selectedSetIds.sentence,selected);
  assert.equal(app.context.session,session);
  assert.equal(app.preferenceWrites.length,writes);
  const restricted=application({availableIds:['variation:b'],sample:.999});
  restricted.handlers.startDefaultPractice();
  assert.deepEqual(restricted.choices[0].ids,['variation:b']);
  assert.equal(restricted.context.selectedSetIds.sentence,'variation:b');
  const practicedMatch=application({group:'移動',recordState:{'sentence:c-1':{assessments:{read:{rating:'unseen',attempts:1}}}}});
  practicedMatch.handlers.startDefaultPractice();
  assert.deepEqual(practicedMatch.choices[0].ids,[]);
  assert.equal(practicedMatch.context.selectedSetIds.sentence,'');
  assert.equal(practicedMatch.context.session.length,0);
  assert.equal(practicedMatch.preferenceWrites.length,0);
});

test('explicit practice affects the next exclusion while list previews and session preparation do not',()=>{
  const app=application({sample:0});
  app.handlers.chooseStudySet('variation:a');
  assert.equal(app.context.lastVariationLessonId,'variation:a');
  assert.equal(app.choices.length,0);
  app.handlers.chooseStudySet('variation:c',{list:true});
  assert.equal(app.context.view,'library');
  assert.equal(app.context.lastVariationLessonId,'variation:a');
  app.context.view='study';
  app.handlers.startSession();
  assert.equal(app.context.lastVariationLessonId,'variation:a');
  assert.equal(app.choices.length,0);
  app.handlers.startDefaultPractice();
  assert.equal(app.choices.at(-1).excludeId,'variation:a');
  assert.equal(app.context.selectedSetIds.sentence,'variation:b');
  assert.equal(JSON.stringify(app.context.records),app.before);
});

test('no unpracticed matches never falls back, while explicit set practice and repeating still work',()=>{
  const recordState=Object.fromEntries(lessons.map(lesson=>[lesson.cards[0].id,{assessments:{read:{rating:'unseen',attempts:1}}}]));
  const app=application({recordState});
  app.handlers.startDefaultPractice();
  assert.deepEqual(app.choices,[{ids:[],excludeId:''}]);
  assert.equal(app.context.view,'home');
  assert.equal(app.context.selectedSetIds.sentence,'');
  assert.equal(app.context.session.length,0);
  assert.equal(app.preferenceWrites.length,0);
  assert.equal(app.spoken,0);
  app.handlers.chooseStudySet('variation:a');
  assert.equal(app.context.view,'study');
  assert.deepEqual(ids(app.context.session),['sentence:a-1','sentence:a-2','sentence:a-3']);
  app.context.position=2;
  app.handlers.startSession(null,{autoplay:true});
  assert.equal(app.context.position,0);
  assert.deepEqual(ids(app.context.session),['sentence:a-1','sentence:a-2','sentence:a-3']);
  const session=app.context.session,writes=app.preferenceWrites.length;
  app.handlers.startDefaultPractice();
  assert.deepEqual(app.choices.at(-1).ids,[]);
  assert.equal(app.context.session,session);
  assert.equal(app.preferenceWrites.length,writes);
  assert.equal(JSON.stringify(app.context.records),app.before);
});
