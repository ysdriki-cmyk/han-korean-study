import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DECKS, getDeck, answerFields, parseDeck } from '../dist/assets/decks.js';
import { createSentenceWordSheet } from '../dist/assets/sentence-word-sheet.js';
import { renderSentenceWords, renderSentenceTranslation2 } from '../dist/assets/sentence-view.js';
import { renderVariationAnswer } from '../dist/assets/variation-view.js';
import { renderConversationNotes } from '../dist/assets/conversation-view.js';
import { buildVariationLessons } from '../dist/assets/variations.js';
import { speechButton } from '../dist/assets/speech-view.js';
import { ratingFor, recordAssessment } from '../dist/assets/assessment.js';
import { getRecord } from '../dist/assets/learning.js';
import { applyBulkRating } from '../dist/assets/bulk-rating.js';
import { practiceSettings, makePracticeSession } from '../dist/assets/practice.js';

const words=parseDeck('vocabulary','id,韓国語,英語,日本語,例文_韓国語,例文_日本語\n1,쓰다,write,書く,메모를 써요.,メモを書きます。\n2,쓰다,bitter,苦い,,').cards;
const sentence=(id,han,kanji,wordId='1')=>({id:`sentence:${id}`,sourceId:id,deckId:'sentence',han,kanji,
  sentenceRefs:[{position:1,korean:'쓰다',wordId}],tags:''});
const base={...sentence('base','써요.','書きます。'),tags:'#variation',variation:{groupId:'write',order:1,title:'書く文',point:'基本の解説'}};
const later={...sentence('later','편지를 써요.','手紙を書きます。'),tags:'#variation',translation2:'手紙をしたためます。',
  variation:{groupId:'write',order:2,title:'書く文',point:'편지를を追加します。',answerVariants:['편지는 써요.']}};
const talk={...sentence('talk','커피가 써요.','コーヒーが苦いです。','2'),tags:'#conversation',
  conversation:{lessonId:'talk',turn:1,speaker:'B',role:'返答',speechStyle:'丁寧',usageNote:'味について返答します。'}};
const empty={...sentence('empty','안녕하세요.','こんにちは。'),sentenceRefs:[]};
const sourceCards=[base,later,talk,empty];
const appSource=readFileSync(new URL('../dist/assets/app.js',import.meta.url),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/gu,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function appFunction(name) {
  const start=appSource.indexOf(`function ${name}(`);
  assert.ok(start>=0,`Missing application function ${name}`);
  const end=appSource.indexOf('\nfunction ',start+1);
  return appSource.slice(start,end<0?undefined:end);
}
function appClickHandler() {
  const prefix="document.addEventListener('click', ",start=appSource.indexOf(prefix),end=appSource.indexOf('\n  });',start);
  assert.ok(start>=0 && end>start);
  return appSource.slice(start+prefix.length,end+4);
}
function classList() {return {add(){},remove(){},toggle(){}};}

/** Execute real library handlers and word controller without a browser or writable storage. */
function application(t,{saveSucceeds=true,pageSize=2}={}) {
  const previousDocument=globalThis.document,elements=new Map(),writes=[],sounds=[],queued=[];
  let focused=null,ghostTouches=0,context;
  function controls(html) {
    return [...html.matchAll(/<(button|input)\b([^>]*)>/gu)].map(([,tag,attributes])=>{
      const attrs=Object.fromEntries([...attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/gu)].map(([,name,value])=>[name,value??'']));
      const element={tag,attrs,dataset:Object.fromEntries(Object.entries(attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/gu,(_,letter)=>letter.toUpperCase()),value])),
        getAttribute:name=>attrs[name]??null,hasAttribute:name=>Object.hasOwn(attrs,name),focus(){focused=element;},
        closest(selector){return selector==='button' || selector==='button,a'?tag==='button'?element:null:null;}};
      return element;
    });
  }
  const matches=(element,selector)=>[...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/gu)].every(([,name,value])=>
    element.hasAttribute(name) && (value===undefined || element.getAttribute(name)===value));
  function element() {
    return {innerHTML:'',textContent:'',value:'',checked:false,open:false,classList:classList(),addEventListener(){},
      querySelectorAll(selector){return controls(this.innerHTML).filter(control=>matches(control,selector));},
      querySelector(selector){return this.querySelectorAll(selector)[0]??null;}};
  }
  const body=element(),detailRoot={
    querySelector(selector){
      if(selector==='.sentence-word')return {set outerHTML(html){body.innerHTML=body.innerHTML.replace(/<section class="sentence-word">[^]*?<\/section>/u,html);}};
      return controls(body.innerHTML).find(control=>matches(control,selector))??null;
    },
  };
  const ghost={querySelector(){return {focus(){ghostTouches++;},set outerHTML(_html){ghostTouches++;}};}};
  const content={...element(),body:{scrollTop:0},feedback:{textContent:''},querySelector(selector){
    if(selector==='.word-sheet-body')return this.body;
    if(selector==='.word-sheet-feedback')return this.feedback;
    return controls(this.innerHTML).find(control=>matches(control,selector))??null;
  }};
  const dialogListeners=new Map(),dialog={...element(),querySelector:()=>content,
    addEventListener:(type,handler)=>dialogListeners.set(type,handler),
    showModal(){this.open=true;},close(){this.open=false;dialogListeners.get('close')?.();}};
  elements.set('#library-body',body);elements.set('#sentence-word-dialog',dialog);
  const $=selector=>{
    if(selector==='#flashcard')return ghost;
    if(selector==='#library-body [data-library-sentence-detail]')return body.innerHTML.includes('data-library-sentence-detail=')?detailRoot:null;
    if(!elements.has(selector))elements.set(selector,element());
    return elements.get(selector);
  };
  const document={body:{dataset:{},classList:classList()},querySelector:selector=>selector.startsWith('#')?$(selector):ghost.querySelector(selector)};
  globalThis.document=document;
  t.after(()=>{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
  const initial=recordAssessment(recordAssessment(getRecord(words[0]),'read','again',{correct:false,now:'2026-11-01T00:00:00Z'}),'write','solid',{correct:true,now:'2026-11-01T00:00:00Z'});
  initial.assessments.read.dueAt='2026-12-01T00:00:00Z';
  const records={[words[0].id]:initial,[words[1].id]:{custom:'other sense'},[later.id]:{assessments:{read:{rating:'good',attempts:4,history:[{correct:true}],dueAt:'2026-12-15T00:00:00Z'}}}};
  const before=JSON.stringify(records);
  context=vm.createContext({$, $$:()=>[],document,DECKS,getDeck,answerFields,createSentenceWordSheet,renderSentenceWords,renderSentenceTranslation2,
    renderVariationAnswer,renderConversationNotes,buildVariationLessons,speechButton,applyBulkRating,practiceSettings,makePracticeSession,esc,badge:rating=>`<span>${rating}</span>`,
    activeDeck:'sentence',sentenceCollection:'core',cards:[...sourceCards],deckData:new Map([['sentence',{cards:sourceCards}],['vocabulary',{cards:words}]]),
    records,settings:{mode:'read',libraryDirection:'ko-han',sessionType:'practice',limit:'all',shuffle:false},preferences:{courses:{vocabulary:{mode:'read'}}},
    expandedLibrarySentenceId:'',libraryWordMode:null,sentenceWordMode:null,view:'library',page:0,pageSize,rankFilter:'all',pageCards:[],
    selected:new Set(),revealedRows:new Set(),lastBulkRatingEdit:null,loaded:true,
    session:[sentence('stale','가요.','行きます。')],sessionLesson:{baseCard:{han:'WRONG SESSION BASE'}},position:0,revealed:true,
    composing:false,compositionEndedAt:0,sessionCards:[],initialCount:0,sessionScope:'all',hintSeeds:new Map(),writeResult:null,submitted:'',
    answers:new Map(),cardViews:new Map(),advancedPositions:new Set(),homeQuery:'',homeGroup:'all',
    RECORD_KEY:'learning-test',speaker:{stop(){},toggle:text=>sounds.push(text)},
    safeWrite:(key,value)=>{if(!saveSucceeds)return false;writes.push({key,value:structuredClone(value)});return true;},
    savePreferences(){},syncSettingsForm(){},updateCourseChrome(){},renderOverview(){},renderCard(){},renderHome(){},speakQuestion(){},
    history:{replaceState(){}},location:{hash:'#library'},kanjiPromptChoices:()=>[],mistakeCoolingDown:()=>false,
    practiceSelected:ids=>queued.push([...ids]),
  });
  context.rank=item=>ratingFor(item,context.records,context.settings.mode);
  context.studyCards=()=>context.cards;
  context.pool=()=>context.cards;
  context.activeStudySet=()=>({kind:'all'});
  const names=['inConversation','inVariation','inOrderedLesson','allVariationLessons','librarySentenceCard','sentenceWordContext','sentenceWordRoot',
    'refreshSentenceWordList','clearLibrarySentence','toggleLibrarySentence','renderLibrarySentenceDetails','renderLibrary','updateSelection',
    'setView','startSession','switchDeck','switchMode','filteredLibrary'];
  const start=appSource.indexOf('const sentenceWordSheet=createSentenceWordSheet('),end=appSource.indexOf('\n});',start);
  assert.ok(start>=0 && end>start);
  vm.runInContext(`${appSource.slice(start,end+4)}\n${names.map(appFunction).join('\n')}
    globalThis.api={sheet:sentenceWordSheet,renderLibrary,toggleLibrarySentence,clearLibrarySentence,librarySentenceCard,sentenceWordContext,sentenceWordRoot,
      setView,startSession,switchDeck,switchMode,filteredLibrary,click:${appClickHandler()}};`,context);
  for(const [id,event] of [['library-search','oninput'],['library-hide','onchange'],['library-direction','onclick'],['prev-page','onclick']]) {
    const line=appSource.split('\n').find(value=>value.startsWith(`  $('#${id}').${event} =`));
    assert.ok(line,`Missing ${id} handler`);vm.runInContext(line,context);
  }
  const changeStart=appSource.indexOf("  $('#library-body').onchange ="),changeEnd=appSource.indexOf('\n  };',changeStart);
  vm.runInContext(appSource.slice(changeStart,changeEnd+5),context);
  context.api.renderLibrary();
  return {context,api:context.api,elements,$,body,dialog,content,writes,sounds,queued,before,
    get focused(){return focused;},get ghostTouches(){return ghostTouches;},
    click(selector){
      const control=body.querySelector(selector);assert.ok(control,`Missing control ${selector}`);
      const wordControl=Object.keys(control.dataset).some(key=>key.startsWith('sentenceWord')) || selector==='[data-speak="쓰다"]';
      const target={closest:query=>['button,a','button,a,input,select,textarea'].includes(query)?control.tag==='button'?control:null:query==='.sentence-word'&&wordControl?detailRoot:null};
      context.api.click({target});
    },
  };
}

test('a sentence expands inline with the shared answer references and only one row stays open without recording practice',t=>{
  const app=application(t);
  app.click('[data-library-sentence="sentence:later"]');
  assert.equal(app.context.expandedLibrarySentenceId,later.id);
  assert.equal((app.body.innerHTML.match(/data-library-sentence-detail=/gu)||[]).length,1);
  const activating=app.body.innerHTML.indexOf('data-library-sentence="sentence:later"');
  const rowEnd=app.body.innerHTML.indexOf('</tr>',activating);
  assert.ok(app.body.innerHTML.slice(rowEnd+5).startsWith('<tr class="library-sentence-detail">'));
  assert.equal(app.body.querySelector('[data-library-sentence="sentence:later"]').getAttribute('aria-expanded'),'true');
  assert.match(app.body.innerHTML,/library-sentence-detail-sentence%3Alater/u);
  assert.match(app.body.innerHTML,/手紙をしたためます。/u);
  assert.match(app.body.innerHTML,/편지를を追加します。/u);
  assert.match(app.body.innerHTML,/편지는 써요。|편지는 써요\./u);
  assert.match(app.body.innerHTML,/使用単語/u);
  assert.match(app.body.innerHTML,/data-speak="쓰다"/u);
  assert.equal(app.api.sentenceWordContext().card.id,later.id);
  app.click('[data-library-sentence="sentence:base"]');
  assert.equal(app.context.expandedLibrarySentenceId,base.id);
  assert.equal((app.body.innerHTML.match(/data-library-sentence-detail=/gu)||[]).length,1);
  assert.doesNotMatch(app.body.innerHTML,/手紙をしたためます。/u);
  app.click('[data-library-sentence="sentence:base"]');
  assert.equal(app.context.expandedLibrarySentenceId,'');
  assert.doesNotMatch(app.body.innerHTML,/data-library-sentence-detail=/u);
  assert.equal(JSON.stringify(app.context.records),app.before);
  assert.deepEqual(app.writes,[]);
});

test('variation details resolve their own full family base even when it is on a different page',t=>{
  const app=application(t,{pageSize:1});
  app.context.page=1;app.api.renderLibrary();
  app.api.toggleLibrarySentence(later.id);
  assert.match(app.body.innerHTML,/variation-comparison/u);
  assert.match(app.body.innerHTML,/元の文/u);
  assert.doesNotMatch(app.body.innerHTML,/WRONG SESSION BASE/u);
  assert.equal(app.api.sentenceWordContext().card.id,later.id);
  assert.equal(app.api.sentenceWordRoot(),app.$('#library-body [data-library-sentence-detail]'));
});

test('conversation notes and the empty-word message use the same revealed-reference content',t=>{
  const app=application(t);
  app.context.page=1;app.context.sentenceCollection='conversation';app.api.renderLibrary();
  app.api.toggleLibrarySentence(talk.id);
  assert.match(app.body.innerHTML,/味について返答します。/u);
  assert.match(app.body.innerHTML,/返答/u);
  assert.match(app.body.innerHTML,/苦い/u);
  app.api.toggleLibrarySentence(empty.id);
  assert.match(app.body.innerHTML,/使用単語はまだ登録されていません/u);
  assert.doesNotMatch(app.body.innerHTML,/味について返答します。/u);
});

test('masked rows in either direction cannot expose details until explicitly revealed',t=>{
  const app=application(t,{pageSize:1});
  app.context.page=1;
  for(const direction of ['han-ko','ko-han']) {
    app.api.clearLibrarySentence();app.context.settings.libraryDirection=direction;app.$('#library-hide').checked=true;
    app.context.revealedRows.clear();app.api.renderLibrary();app.api.toggleLibrarySentence(later.id);
    assert.equal(app.context.expandedLibrarySentenceId,'');
    assert.doesNotMatch(app.body.innerHTML,/data-library-sentence=|data-library-sentence-detail=|手紙をしたためます|편지를を追加|data-sentence-word-/u);
    assert.equal(app.api.librarySentenceCard(),null);
    if(direction==='han-ko')assert.doesNotMatch(app.body.innerHTML,/편지를 써요|data-speak=/u);
    else assert.doesNotMatch(app.body.innerHTML,/手紙を書きます/u);
    app.click('[data-reveal-row="sentence:later"]');
    app.click('[data-library-sentence="sentence:later"]');
    assert.equal(app.api.librarySentenceCard().id,later.id);
    assert.match(app.body.innerHTML,/手紙をしたためます/u);
  }
  assert.deepEqual(app.writes,[]);
  assert.equal(JSON.stringify(app.context.records),app.before);
});

test('search, paging, hide and direction changes close the row, including when the same sentence remains visible',t=>{
  const app=application(t);
  app.api.toggleLibrarySentence(later.id);app.$('#library-search').value='편지';app.$('#library-search').oninput();
  assert.equal(app.context.expandedLibrarySentenceId,'');
  assert.ok(app.context.pageCards.some(item=>item.id===later.id));
  app.api.toggleLibrarySentence(later.id);app.$('#library-hide').checked=true;app.$('#library-hide').onchange();
  assert.equal(app.context.expandedLibrarySentenceId,'');
  app.click('[data-reveal-row="sentence:later"]');app.api.toggleLibrarySentence(later.id);
  app.$('#library-direction').onclick();assert.equal(app.context.expandedLibrarySentenceId,'');
  app.$('#library-hide').checked=false;app.$('#library-search').value='';app.api.renderLibrary();app.api.toggleLibrarySentence(later.id);
  app.$('#next-page').onclick();assert.equal(app.context.expandedLibrarySentenceId,'');
  app.api.toggleLibrarySentence(talk.id);app.api.filteredLibrary('all');
  assert.equal(app.context.expandedLibrarySentenceId,'');
  assert.deepEqual(app.writes,[]);
});

test('selecting, playing audio and queuing practice are separate from opening a sentence',t=>{
  const app=application(t);
  app.$('#library-body').onchange({target:{dataset:{selectCard:later.id},checked:true}});
  assert.equal(app.context.selected.has(later.id),true);
  assert.equal(app.context.expandedLibrarySentenceId,'');
  app.click('[data-speak="편지를 써요."]');
  assert.deepEqual(app.sounds,['편지를 써요.']);
  assert.equal(app.context.expandedLibrarySentenceId,'');
  app.click('[data-queue-card="sentence:later"]');
  assert.deepEqual(app.queued,[[later.id]]);
  assert.equal(app.context.expandedLibrarySentenceId,'');
  app.api.toggleLibrarySentence(later.id);
  app.$('#library-body').onchange({target:{dataset:{selectCard:base.id},checked:true}});
  app.click('[data-speak="편지를 써요."]');
  assert.equal(app.context.expandedLibrarySentenceId,later.id);
  assert.equal(app.context.selected.has(base.id),true);
  assert.equal(JSON.stringify(app.context.records),app.before);
});

test('library word edits update only that word and direction and return focus inside the library root',t=>{
  const app=application(t);
  app.api.toggleLibrarySentence(later.id);
  assert.equal(app.api.sentenceWordContext().card.id,later.id);
  app.click('[data-sentence-word-status="0"]');
  assert.equal(app.dialog.open,false);
  assert.match(app.body.innerHTML,/id="library-sentence-word-ratings-0"/u);
  assert.doesNotMatch(app.body.innerHTML,/id="study-sentence-word-ratings-0"/u);
  app.click('[data-sentence-word-mode="write"]');
  assert.equal(app.context.libraryWordMode,'write');
  assert.equal(app.context.settings.mode,'read');
  app.click('[data-sentence-word-rating="good"]');
  const old=JSON.parse(app.before);
  assert.equal(ratingFor(words[0],app.context.records,'write'),'good');
  assert.deepEqual(app.context.records[words[0].id].assessments.read,old[words[0].id].assessments.read);
  assert.deepEqual(app.context.records[words[1].id],old[words[1].id]);
  assert.deepEqual(app.context.records[later.id],old[later.id]);
  for(const field of ['attempts','correct','wrong','lastAt','history','dueAt'])assert.deepEqual(app.context.records[words[0].id].assessments.write[field],old[words[0].id].assessments.write[field]);
  assert.equal(app.context.expandedLibrarySentenceId,later.id);
  assert.equal(app.focused.dataset.sentenceWordStatus,'0');
  assert.equal(app.ghostTouches,0);
  app.click('[data-sentence-word-open="0"]');assert.equal(app.dialog.open,true);
  assert.match(app.content.innerHTML,/メモを書きます。/u);
  app.api.sheet.close();assert.equal(app.focused.dataset.sentenceWordOpen,'0');
  assert.equal(app.ghostTouches,0);
});

test('a failed library word save preserves records and the row while navigation prevents stale edits',t=>{
  const app=application(t,{saveSucceeds:false});
  app.api.toggleLibrarySentence(later.id);app.click('[data-sentence-word-status="0"]');
  app.click('[data-sentence-word-rating="good"]');
  assert.match(app.body.innerHTML,/保存できませんでした/u);
  assert.equal(app.context.expandedLibrarySentenceId,later.id);
  assert.equal(JSON.stringify(app.context.records),app.before);
  app.$('#next-page').onclick();
  assert.equal(app.api.sheet.inlineState(),null);
  assert.equal(app.api.sheet.rateInline('good'),false);
  assert.equal(JSON.stringify(app.context.records),app.before);
  assert.deepEqual(app.writes,[]);
});

test('changing view, learning direction or course closes library context without recording a practice attempt',t=>{
  const app=application(t);
  app.api.toggleLibrarySentence(later.id);app.api.setView('home');
  assert.equal(app.context.expandedLibrarySentenceId,'');
  assert.equal(app.api.sentenceWordContext().card,null);
  app.api.setView('library');app.api.toggleLibrarySentence(later.id);app.api.switchMode('write');
  assert.equal(app.context.expandedLibrarySentenceId,'');
  app.api.toggleLibrarySentence(later.id);app.api.switchDeck('vocabulary');
  assert.equal(app.context.activeDeck,'vocabulary');
  assert.equal(app.context.expandedLibrarySentenceId,'');
  assert.equal(app.api.librarySentenceCard(),null);
  assert.doesNotMatch(app.body.innerHTML,/data-library-sentence=/u);
  assert.equal(JSON.stringify(app.context.records),app.before);
  assert.deepEqual(app.writes,[]);
});
