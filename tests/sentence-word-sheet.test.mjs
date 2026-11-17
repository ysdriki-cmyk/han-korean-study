import test from 'node:test';
import assert from 'node:assert/strict';
import { createSentenceWordSheet } from '../dist/assets/sentence-word-sheet.js';
import { parseDeck } from '../dist/assets/decks.js';
import { renderSentenceWords } from '../dist/assets/sentence-view.js';
import { applyBulkRating } from '../dist/assets/bulk-rating.js';
import { recordAssessment, ratingFor } from '../dist/assets/assessment.js';
import { getRecord } from '../dist/assets/learning.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const words=parseDeck('vocabulary','id,韓国語,英語,日本語,例文_韓国語,例文_日本語\n1,쓰다,write,書く,메모를 써요.,メモを書きます。\n2,쓰다,bitter,苦い,,').cards;
const card=parseDeck('sentence','id_sentence,例文_韓国語,例文_日本語,使用韓国語_1\ncurrent,써요.,書きます。,쓰다').cards[0];
const OLD='2026-11-01T01:00:00.000Z';
const NOW='2026-11-15T01:00:00.000Z';

function classList() {
  const values=new Set();
  return {
    add:value=>values.add(value),remove:value=>values.delete(value),contains:value=>values.has(value),
    toggle(value,force) {const active=force??!values.has(value);active?values.add(value):values.delete(value);return active;},
  };
}

/** Only the row rendering, native-dialog, event and focus surface used by the controller. */
function fixture(t,{currentCard=card,saveSucceeds=true,reorderAfterSave=false}={}) {
  const previousDocument=globalThis.document;
  let focused=null,stops=0,inlineChanges=0,sheet;
  const calls=[],modeCalls=[];
  const initial=recordAssessment(recordAssessment(getRecord(words[0]),'read','again',{correct:false,now:OLD}),'write','solid',{correct:true,now:OLD});
  initial.assessments.read.dueAt='2026-11-20T01:00:00.000Z';
  const context={card:structuredClone(currentCard),words,sentences:[currentCard],records:{
    [words[0].id]:initial,[words[1].id]:{custom:'other word sense'},[card.id]:{custom:'sentence history'},
  },mode:'read'};
  const before=structuredClone(context.records);

  function button(attributes) {
    const attrs=Object.fromEntries([...attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/gu)].map(([,name,value])=>[name,value??'']));
    return {dataset:Object.fromEntries(Object.entries(attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/gu,(_,letter)=>letter.toUpperCase()),value])),
      hasAttribute:name=>Object.hasOwn(attrs,name),getAttribute:name=>attrs[name]??null,
      focus(){focused=this;},
      ...{attrs},
    };
  }
  function buttons(html) {
    return [...html.matchAll(/<button\b([^>]*)>/gu)].map(([,attributes])=>{
      const element=button(attributes);element.closest=selector=>selector==='button'?element:null;return element;
    });
  }
  function matches(element,selector) {
    return [...selector.matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]+)))?\]/gu)].every(([,name,quoted,bare])=>
      element.hasAttribute(name) && (quoted===undefined && bare===undefined || element.getAttribute(name)===(quoted??bare)));
  }
  const content={html:'',buttons:[],body:null,feedback:null,
    set innerHTML(html){this.html=html;this.buttons=buttons(html);this.body=html.includes('word-sheet-body')?{scrollTop:0}:null;this.feedback=html.includes('word-sheet-feedback')?{textContent:''}:null;},
    get innerHTML(){return this.html;},
    querySelector(selector){
      if(selector==='.word-sheet-body')return this.body;
      if(selector==='.word-sheet-feedback')return this.feedback;
      if(selector.startsWith('['))return this.buttons.find(element=>matches(element,selector))??null;
      return null;
    },
  };
  const listeners=new Map();
  const dialog={open:false,classList:classList(),
    querySelector:selector=>selector==='#sentence-word-sheet'?content:null,
    addEventListener(type,handler){listeners.set(type,handler);},
    showModal(){this.open=true;},
    close(){this.open=false;listeners.get('close')?.();},
  };
  let table=[],tableHTML='';
  const refreshTable=()=>{
    tableHTML=renderSentenceWords(context.card,context.words,context.records,context.mode,sheet?.inlineState());
    table=buttons(tableHTML);
  };
  const document={body:{classList:classList()},querySelector:selector=>table.find(element=>matches(element,selector))??null};
  globalThis.document=document;
  t.after(()=>{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
  refreshTable();
  sheet=createSentenceWordSheet({dialog,getContext:()=>context,
    stopSpeech:()=>{stops++;},
    onInlineChange:()=>{inlineChanges++;refreshTable();},
    onMode:mode=>{modeCalls.push(mode);context.mode=mode;refreshTable();},
    onRating:(id,mode,rating)=>{
      calls.push({id,mode,rating});
      if(!saveSucceeds)return false;
      const word=words.find(item=>item.id===id);
      context.records=applyBulkRating([word],context.records,[id],mode,rating,NOW).records;
      if(reorderAfterSave)context.words=[...context.words].reverse();
      refreshTable();return true;
    },
  });
  return {sheet,dialog,content,context,before,calls,modeCalls,document,
    get focused(){return focused;},get stops(){return stops;},
    get tableHTML(){return tableHTML;},get inlineChanges(){return inlineChanges;},
    tableButton:selector=>table.find(element=>matches(element,selector)),
    click(selector){
      const target=content.querySelector(selector);assert.ok(target,`Missing button ${selector}`);
      listeners.get('click')({target,stopPropagation(){}});
    },
  };
}

test('status symbols expand only their row without a modal and save before returning focus to the same sense',t=>{
  const f=fixture(t,{reorderAfterSave:true});
  f.sheet.open(0,{status:true});
  assert.equal(f.dialog.open,false);
  assert.equal(f.document.body.classList.contains('word-sheet-open'),false);
  assert.equal(f.sheet.isOpen(),true);
  assert.ok(f.inlineChanges>0);
  assert.equal((f.tableHTML.match(/data-sentence-word-rating=/gu)||[]).length,6);
  assert.match(f.tableHTML,/data-sentence-word-rating="again"[^>]*aria-pressed="true"/u);
  assert.equal(f.tableButton('[data-sentence-word-status="0"]').getAttribute('aria-expanded'),'true');
  assert.doesNotMatch(f.content.innerHTML,/word-sheet-examples|word-sheet-meaning|メモを書きます。/u);
  assert.equal(f.sheet.rateInline('good'),true);
  assert.deepEqual(f.calls,[{id:'vocabulary:1',mode:'read',rating:'good'}]);
  assert.equal(ratingFor(words[0],f.context.records,'read'),'good');
  assert.equal(ratingFor(words[0],f.context.records,'write'),'solid');
  assert.deepEqual(f.context.records[words[0].id].assessments.write,f.before[words[0].id].assessments.write);
  assert.deepEqual(f.context.records[words[1].id],f.before[words[1].id]);
  assert.deepEqual(f.context.records[card.id],f.before[card.id]);
  for(const field of ['attempts','correct','wrong','lastAt','history','dueAt'])assert.deepEqual(f.context.records[words[0].id].assessments.read[field],f.before[words[0].id].assessments.read[field]);
  assert.equal(f.dialog.open,false);
  assert.equal(f.sheet.isOpen(),false);
  assert.equal(f.sheet.inlineState(),null);
  assert.doesNotMatch(f.tableHTML,/data-sentence-word-rating=/u);
  assert.equal(f.document.body.classList.contains('word-sheet-open'),false);
  assert.equal(f.focused.dataset.sentenceWordStatus,'1');
});

test('switching directions keeps choices in the row and updates the matching vocabulary status only',t=>{
  const f=fixture(t);
  f.sheet.open(0,{status:true});
  f.sheet.setMode('write');
  assert.deepEqual(f.modeCalls,['write']);
  assert.equal(f.dialog.open,false);
  assert.equal(f.sheet.isOpen(),true);
  assert.match(f.tableHTML,/data-sentence-word-rating="solid"[^>]*aria-pressed="true"/u);
  assert.match(f.tableHTML,/data-sentence-word-mode="read"/u);
  assert.doesNotMatch(f.content.innerHTML,/word-sheet-examples|word-sheet-meaning/u);
  assert.equal(f.sheet.rateInline('unsure'),true);
  assert.deepEqual(f.calls,[{id:'vocabulary:1',mode:'write',rating:'unsure'}]);
  assert.equal(ratingFor(words[0],f.context.records,'write'),'unsure');
  assert.deepEqual(f.context.records[words[0].id].assessments.read,f.before[words[0].id].assessments.read);
  assert.equal(f.dialog.open,false);
});

test('a failed save leaves row choices open with feedback and preserves records',t=>{
  const f=fixture(t,{saveSucceeds:false});
  f.sheet.open(0,{status:true});
  assert.equal(f.sheet.rateInline('good'),false);
  assert.equal(f.dialog.open,false);
  assert.equal(f.sheet.isOpen(),true);
  assert.match(f.sheet.inlineState().feedback,/保存できませんでした/u);
  assert.match(f.tableHTML,/保存できませんでした/u);
  assert.deepEqual(f.context.records,f.before);
  assert.doesNotMatch(f.content.innerHTML,/word-sheet-examples|word-sheet-meaning/u);
  f.sheet.close();
  assert.equal(f.focused.dataset.sentenceWordStatus,'0');
});

test('word names retain the full details after saving and restore focus to the name on close',t=>{
  const f=fixture(t);
  f.sheet.open(0,{status:true});
  f.sheet.open(0);
  assert.equal(f.sheet.inlineState(),null);
  assert.equal(f.dialog.open,true);
  assert.match(f.content.innerHTML,/word-sheet-examples/u);
  assert.match(f.content.innerHTML,/lang="en">write/u);
  assert.match(f.content.innerHTML,/メモを書きます。/u);
  f.click('[data-word-sheet-rating="good"]');
  assert.equal(f.dialog.open,true);
  assert.equal(f.content.feedback.textContent,'保存しました');
  assert.match(f.content.innerHTML,/メモを書きます。/u);
  f.sheet.close();
  assert.equal(f.focused.dataset.sentenceWordOpen,'0');
});

test('unregistered references allow details but never open editable status choices',t=>{
  const missing={...card,sentenceRefs:[{position:1,korean:'미등록어'}]};
  const f=fixture(t,{currentCard:missing});
  assert.match(renderSentenceWords(missing,words),/data-sentence-word-status="0"[^>]* disabled/u);
  f.sheet.open(0,{status:true});
  assert.equal(f.dialog.open,false);
  assert.equal(f.sheet.inlineState(),null);
  assert.deepEqual(f.calls,[]);
  f.sheet.open(0);
  assert.equal(f.dialog.open,true);
  assert.match(f.content.innerHTML,/単語帳に未登録/u);
  assert.doesNotMatch(f.content.innerHTML,/data-word-sheet-rating=/u);
});

test('a changed sentence cannot save a stale status choice to its former word',t=>{
  const f=fixture(t);
  f.sheet.open(0,{status:true});
  f.context.card={...card,id:'sentence:next'};
  assert.equal(f.sheet.rateInline('good'),false);
  assert.deepEqual(f.calls,[]);
  assert.deepEqual(f.context.records,f.before);
  assert.equal(f.dialog.open,false);
  assert.equal(f.sheet.inlineState(),null);
});

test('status toggles affect one row at a time and switching homonyms cannot edit the previous sense',t=>{
  const f=fixture(t);
  f.sheet.open(0,{status:true});
  const first=f.sheet.inlineState().key;
  f.sheet.open(1,{status:true});
  assert.notEqual(f.sheet.inlineState().key,first);
  assert.equal((f.tableHTML.match(/data-sentence-word-rating=/gu)||[]).length,6);
  assert.equal(f.tableButton('[data-sentence-word-status="0"]').getAttribute('aria-expanded'),'false');
  assert.equal(f.tableButton('[data-sentence-word-status="1"]').getAttribute('aria-expanded'),'true');
  f.sheet.open(1,{status:true});
  assert.equal(f.sheet.inlineState(),null);
  assert.equal(f.sheet.isOpen(),false);
  assert.deepEqual(f.calls,[]);
  f.sheet.open(1,{status:true});
  assert.equal(f.sheet.rateInline('good'),true);
  assert.deepEqual(f.calls,[{id:'vocabulary:2',mode:'read',rating:'good'}]);
  assert.deepEqual(f.context.records[words[0].id],f.before[words[0].id]);
});

test('refresh clears an obsolete inline word without opening a dialog or saving anything',t=>{
  const f=fixture(t);
  f.sheet.open(0,{status:true});
  f.context.words=[words[1]];
  f.sheet.refresh();
  assert.equal(f.sheet.inlineState(),null);
  assert.equal(f.sheet.isOpen(),false);
  assert.equal(f.dialog.open,false);
  assert.deepEqual(f.calls,[]);
  assert.deepEqual(f.context.records,f.before);
  assert.doesNotMatch(f.tableHTML,/data-sentence-word-rating=/u);
});

const appSource=readFileSync(new URL('../dist/assets/app.js',import.meta.url),'utf8');
function appDocumentHandler(type) {
  const prefix=`document.addEventListener('${type}', `;
  const start=appSource.lastIndexOf(prefix);
  assert.ok(start>=0,`Missing ${type} handler`);
  const end=appSource.indexOf('\n  });',start);
  assert.ok(end>start);
  return appSource.slice(start+prefix.length,end+4);
}

test('actual application clicks keep sound, row ratings and word details as separate actions',t=>{
  const f=fixture(t),sounds=[];
  const context=vm.createContext({sentenceWordSheet:f.sheet,speaker:{toggle:text=>sounds.push(text)},loaded:true,activeDeck:'sentence',inConversation:()=>false});
  vm.runInContext(`globalThis.handle=${appDocumentHandler('click')};`,context);
  const click=selector=>{
    const target=f.tableButton(selector);assert.ok(target,`Missing button ${selector}`);
    const eventTarget={closest:query=>['button,a','button,a,input,select,textarea','.sentence-word'].includes(query)?target:null};
    context.handle({target:eventTarget});
  };
  click('[data-speak="쓰다"]');
  assert.deepEqual(sounds,['쓰다']);
  assert.equal(f.sheet.isOpen(),false);
  assert.deepEqual(f.calls,[]);
  click('[data-sentence-word-status="0"]');
  assert.equal(f.dialog.open,false);
  assert.equal(f.sheet.isOpen(),true);
  click('[data-speak="쓰다"]');
  assert.deepEqual(sounds,['쓰다','쓰다']);
  assert.equal(f.sheet.isOpen(),true);
  assert.deepEqual(f.calls,[]);
  click('[data-sentence-word-mode="write"]');
  assert.equal(f.context.mode,'write');
  click('[data-sentence-word-rating="good"]');
  assert.deepEqual(f.calls,[{id:'vocabulary:1',mode:'write',rating:'good'}]);
  click('[data-sentence-word-open="0"]');
  assert.equal(f.dialog.open,true);
  assert.deepEqual(sounds,['쓰다','쓰다']);
});

test('actual application keyboard handling protects sentence ratings during inline edits and Escape restores focus',t=>{
  const f=fixture(t),sentenceRatings=[];
  const context=vm.createContext({view:'study',settings:{mode:'read'},revealed:true,sentenceWordSheet:f.sheet,
    $:()=>({open:false}),STATUSES:[{id:'hard'}],rateCard:rating=>sentenceRatings.push(rating)});
  vm.runInContext(`globalThis.handle=${appDocumentHandler('keydown')};`,context);
  const event=key=>({key,code:key==='1'?'Digit1':key,target:{closest:()=>null},preventDefault(){this.prevented=true;}});
  f.sheet.open(0,{status:true});
  context.handle(event('1'));
  assert.deepEqual(sentenceRatings,[]);
  const escape=event('Escape');
  context.handle(escape);
  assert.equal(f.sheet.isOpen(),false);
  assert.equal(escape.prevented,true);
  assert.equal(f.focused.dataset.sentenceWordStatus,'0');
  assert.deepEqual(f.calls,[]);
  context.handle(event('1'));
  assert.deepEqual(sentenceRatings,['hard']);
  assert.deepEqual(f.context.records,f.before);
});
