import {makeSession} from './core.js';
import {DECKS,getDeck,parseDeck,restoreLearningRecords,answerFields} from './decks.js';
import {acceptedVocabularyAnswers,matchVocabularyAnswer} from './vocabulary.js';
import {RANKS, getRecord, setRank, recordRecall, recordReading, recordWriting, isEligible, matchHangul} from './learning.js';
import {icon} from './icons.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = (value='') => String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const config = window.APP_CONFIG || {};
const RECORD_KEY='han-hanja:learning:v3', PREF_KEY='han-hanja:preferences:v3';
const rankById=new Map(RANKS.map(rank=>[rank.id,rank]));
const descriptions={required:'まず、覚えたいことば',next:'次に取り組みたいことば',later:'時間のあるときに、ゆっくり',manji:'次のテストで覚える',fair:'初めて、なんとか思い出せた',mastered:'しっかり思い出せる',read:'読むテストをクリア',read2:'書くテストまで、できた'};
const stages=[{id:'choose',number:'01',label:'えらぶ',caption:'次のテストに向けて'},{id:'recall',number:'02',label:'思い出す',caption:'テスト待ち・練習中'},{id:'read',number:'03',label:'読む',caption:'読んで、確かめる'},{id:'write',number:'04',label:'書く',caption:'自分で、書いてみる'}];
let cards=[], records=Object.create(null), stage='recall',direction='ko-han',view='study';
let activeDeck='vocabulary', preferences={courses:{}}, deckData=new Map();
let session=[],position=0,revealed=false,writeResult=null,submitted='',answers=new Map(),cycleSeen=new Set();
let rankFilter='all',page=0,selected=new Set(),revealedRows=new Set(),pageCards=[];
let loaded=false,storageAvailable=true,polling=false,composing=false,toastTimer;
const pageSize=30;
function readJSON(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback;}catch{return fallback;}}
function safeWrite(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{storageAvailable=false;$('#save-status').textContent='今回は一時的に記録';notice('このブラウザでは記録を保存できません。サイトデータの保存を許可すると、続きから学習できます。',true);return false;}}
function notice(text,error=false){if(!storageAvailable&&!text)text='このブラウザでは記録を保存できません。サイトデータの保存を許可してください。';$('#notice').textContent=text;$('#notice').hidden=!text;$('#notice').classList.toggle('error',error||!storageAvailable);}
function toast(text,error=false){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').hidden=false;$('#toast').classList.toggle('error',error);toastTimer=setTimeout(()=>{$('#toast').hidden=true;},3700);}
function record(card){return getRecord(card,records);}
function rank(card){return record(card).rank;}
function badge(id){const info=rankById.get(id);return `<span class="rank-badge rank-${id}">${info.label}</span>`;}
function saveRecords(){safeWrite(RECORD_KEY,{version:3,records});}
function savePreferences(){preferences.deckId=activeDeck;preferences.courses[activeDeck]={direction,stage};safeWrite(PREF_KEY,preferences);}
function counts(){const result=Object.fromEntries(RANKS.map(item=>[item.id,0]));cards.forEach(card=>result[rank(card)]++);return result;}
function pool(){return cards.filter(card=>isEligible(card,record(card),stage));}
function stageCount(id,c){return id==='choose'?c.required+c.next+c.later:id==='recall'?c.manji+c.fair:id==='read'?c.mastered:c.read;}
function renderOverview(){
  const c=counts();$('#nav-count').textContent=cards.length;$('#library-total').textContent=cards.length;
  $('#stage-path').innerHTML=stages.map(item=>`<button class="stage-step${item.id===stage?' active':''}" data-stage="${item.id}" aria-pressed="${item.id===stage}"><span class="step-number">${item.number}</span><span class="step-copy"><strong>${item.label}</strong><small>${item.caption}</small></span><span class="step-count">${stageCount(item.id,c)}</span><span class="step-arrow">↗</span></button>`).join('');
  const mastered=c.mastered+c.read+c.read2;
  $('#settled-count').innerHTML=`${mastered}<small> / ${cards.length}</small>`;$('#settled-percent').textContent=`${cards.length?Math.round(mastered/cards.length*100):0}%`;
  $('#rank-distribution').innerHTML=RANKS.filter(item=>c[item.id]).map(item=>`<span class="rank-${item.id}" style="width:${c[item.id]/cards.length*100}%" title="${item.label} ${c[item.id]}枚"></span>`).join('');
  $('#rank-distribution').setAttribute('role','img');$('#rank-distribution').setAttribute('aria-label',RANKS.map(item=>`${item.label}${c[item.id]}枚`).join('、'));
  $('#rank-board').innerHTML=RANKS.map(item=>`<button class="rank-tile rank-${item.id}" data-rank-tile="${item.id}">${badge(item.id)}<strong>${c[item.id]}<small style="font-size:9px;margin-left:5px;color:#b3bfa9">枚</small></strong><p>${descriptions[item.id]}</p><span class="tile-arrow">↗</span></button>`).join('');
  $('#rank-filters').innerHTML=`<button class="rank-filter" data-rank-filter="all" aria-pressed="${rankFilter==='all'}">すべて <strong>${cards.length}</strong></button>`+RANKS.map(item=>`<button class="rank-filter" data-rank-filter="${item.id}" aria-pressed="${rankFilter===item.id}"><span class="rank-dot rank-${item.id}"></span>${item.label}<strong>${c[item.id]}</strong></button>`).join('');
  renderSessionStats();
}
function renderSessionStats(){const right=[...answers.values()].filter(value=>value.passed).length;$('#session-done').textContent=answers.size;$('#session-total').textContent=session.length;$('#session-progress').style.width=`${session.length?answers.size/session.length*100:0}%`;$('#set-right').textContent=right;$('#set-wrong').textContent=answers.size-right;$('#session-caption').textContent=!session.length?'次の一歩を、ことば一覧から。':position>=session.length?'ひと区切り。少しずつ、身についていく。':answers.size?'いいペース。自分の速さで進もう。':'ひと呼吸して、はじめよう。';}
function stageMeta(){const deck=getDeck(activeDeck);return {
  recall:{title:'思い出すテスト',label:'テスト待ち → 練習中 → 覚えた',index:'02',guide:'答えを思い出してから、めくってみよう。',tipTitle:'最初の「できた」を、<br>重ねていこう。',tipCopy:'初めて答えられたら「練習中」。<br>もう一度答えられたら「覚えた」へ。',from:'fair',to:'mastered'},
  read:{title:'読むテスト — 意味を思い出す。',label:'覚えた → 読むテスト済み',index:'03',guide:`韓国語を読んで、${deck.answerLabel}を思い出そう。`,tipTitle:'見たことばが、<br>意味につながる。',tipCopy:'「覚えた」のことばを、もう一度。<br>意味がわかれば、次は書くテストへ。',from:'mastered',to:'read'},
  write:{title:'書くテスト — 自分で、書ける。',label:'読むテスト済み → 定着',index:'04',guide:'韓国語を入力して、記憶を確かめよう。',tipTitle:'思い出した音を、<br>自分の手で。',tipCopy:`${deck.answerLabel}から韓国語を入力。<br>書けたことばは「定着」へ。`,from:'read',to:'read2'}
}[stage];}
function updateCourseChrome(){
  const deck=getDeck(activeDeck),vocab=activeDeck==='vocabulary';
  $$('[data-deck]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.deck===activeDeck));button.disabled=loaded&&!deckData.has(button.dataset.deck);});
  $('#art-answer').textContent=deck.answerShort;$('#art-answer-kicker').textContent=vocab?'MEANING':'KANJI';
  $('#forward-source').textContent=vocab?'韓国語':'ハングル';$('#forward-answer').textContent=deck.answerLabel;
  $('#reverse-mark').textContent=deck.answerShort;$('#reverse-answer').textContent=deck.answerLabel;$('#reverse-target').textContent=vocab?'韓国語':'ハングル';
  $('#library-answer-label').textContent=deck.answerLabel;
  const searchText=vocab?'韓国語・日本語・英語を検索':'ハングル・漢字・意味を検索';$('#library-search').placeholder=searchText;$('#library-search').setAttribute('aria-label',searchText);
  document.title=`한と漢 — ${deck.label}の学習ノート`;
}
function switchDeck(id){
  if(!DECKS.some(deck=>deck.id===id)||id===activeDeck)return;
  savePreferences();activeDeck=id;const pref=preferences.courses[id]||{};
  direction=['ko-han','han-ko'].includes(pref.direction)?pref.direction:'ko-han';stage=['recall','read','write'].includes(pref.stage)?pref.stage:'recall';
  cards=deckData.get(id)?.cards||[];selected.clear();revealedRows.clear();rankFilter='all';page=0;$('#library-search').value='';
  updateCourseChrome();startSession();renderLibrary();savePreferences();
  toast(`${getDeck(id).label}コースに切り替えました。`);
}
function updateStudyChrome(){updateCourseChrome();const meta=stageMeta();$('#study-title').textContent=meta.title;$('#stage-label').textContent=meta.label;$('#stage-index').textContent=meta.index;$('#direction-switch').hidden=stage!=='recall';$('#practice-hint').textContent=meta.guide;$('#next-tip-title').innerHTML=meta.tipTitle;$('#next-tip-copy').innerHTML=meta.tipCopy;$('#mini-ranks').innerHTML=`${badge(meta.from)}<span>→</span>${badge(meta.to)}`;$('#pool-caption').textContent=`${pool().length}枚が、このステップで待っています`;$('.keyboard-hint').hidden=stage==='write';$$('[data-direction]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.direction===direction)));}
function startSession(custom=null,{continuing=false}={}){composing=false;if(!continuing)cycleSeen=new Set();session=makeSession(custom||pool(),{limit:$('#session-limit').value,shuffle:$('#shuffle').checked});position=0;revealed=false;writeResult=null;submitted='';answers=new Map();updateStudyChrome();renderOverview();renderCard();}
function setStage(next){if(next==='choose'){rankFilter='all';page=0;setView('library');return;}if(!['recall','read','write'].includes(next))return;stage=next;savePreferences();setView('study');if(loaded)startSession();}
function nextDirection(){return stage==='read'?'ko-han':stage==='write'?'han-ko':direction;}
function answerRows(card){
  const main=nextDirection()==='han-ko'
    ? `<div class="answer-row"><span class="answer-label">韓国語</span><p class="answer-value hangul" lang="ko">${esc(card.han)}</p></div>`
    : answerFields(card,activeDeck).map(field=>`<div class="answer-row"><span class="answer-label">${field.label}</span><p class="answer-value" lang="${field.lang}">${esc(field.text)}</p></div>`).join('');
  const examples=activeDeck==='vocabulary'&&card.exampleKo?`<div class="example-block"><span>例文</span><p lang="ko">${esc(card.exampleKo)}</p>${card.exampleJp?`<small>${esc(card.exampleJp)}</small>`:''}</div>`:'';
  return main+examples;
}
function questionMarkup(card,reverse){
  if(reverse&&activeDeck==='vocabulary'){
    const japanese=card.kanji,english=card.english||card.meaning;
    return `<p class="question-word reverse" lang="${japanese?'ja':'en'}">${esc(japanese||english)}</p>${japanese&&english?`<p class="question-english" lang="en">${esc(english)}</p>`:''}`;
  }
  const text=reverse?answerFields(card,activeDeck).map(field=>field.text).join('\n'):card.han;
  return `<p class="question-word${reverse?' reverse':text.length>4?' long':''}" ${reverse?'':'lang="ko"'}>${esc(text)}</p>`;
}
function renderCard(){
  const el=$('#flashcard');el.setAttribute('aria-busy',String(!loaded));el.dataset.stage=stage;el.classList.toggle('revealed',revealed);
  if(!loaded)return;
  if(!cards.length){el.innerHTML=`<div class="empty-state"><div class="complete-mark">${icon('cards')}</div><h3>学習ノートを開けませんでした</h3><p>通信を確認して、もう一度開いてみてください。</p><button class="button primary" data-action="reload">もう一度読み込む</button></div>`;return;}
  if(!session.length){const copy=stage==='recall'?['次に覚える、ことばを選ぼう。','ことば一覧で「テスト待ち」にしたことばが、<br>ここでのテストに並びます。','ことばを選ぶ','library']:stage==='read'?['「覚えた」の先に、読むテスト。','思い出すテストで「覚えた」になったら、<br>ここでハングルから意味を確認できます。','思い出すテストへ','recall']:['読めたら、次は書いてみよう。','読むテストをクリアしたことばが、<br>ハングルの書くテストに進みます。','読むテストへ','read'];el.innerHTML=`<div class="empty-state"><div class="complete-mark">${icon(stage==='write'?'check':'sparkle')}</div><h3>${copy[0]}</h3><p>${copy[1]}</p><button class="button primary" data-go="${copy[3]}">${copy[2]} <span>↗</span></button></div>`;return;}
  if(position>=session.length){renderComplete(el);return;}
  const card=session[position],rec=record(card),reverse=nextDirection()==='han-ko';
  const deck=getDeck(activeDeck),isVocab=activeDeck==='vocabulary';
  const writingChoices=isVocab?acceptedVocabularyAnswers(card):[card.han];
  let footer;
  if(stage==='write')footer=writeResult===null?`<button type="submit" form="write-form" class="reveal-button" id="check-writing">書いた答えを確認する ${icon('arrow')}</button><p class="card-action-caption">${submitted?'入力してから、もう一度確認してみよう。':'わからないときは、答えを見て覚え直そう。'} <button class="text-link" style="display:inline;padding:0 0 0 4px;font-size:8px" data-action="skip-writing">答えを見る</button></p>`:`<button id="next-writing" class="reveal-button" data-action="advance">${writeResult?'次のことばへ':'テスト待ちに戻して、次へ'} ${icon('arrow')}</button><p class="card-action-caption">${writeResult?'書けたことばを「定着」に記録しました。':'思い出せなかったことばは「テスト待ち」で、また練習できます。'}</p>`;
  else if(!revealed)footer=`<button id="reveal-card" class="reveal-button" data-action="reveal">${icon('eye')}答えを見る ${icon('arrow')}</button><p class="card-action-caption">答えを見てから、思い出せたか振り返ろう。</p>`;
  else{const target=stage==='read'?'read':rec.rank==='fair'?'mastered':'fair';const successLabel=target==='fair'?'答えられた → 練習中':target==='mastered'?'しっかり答えた → 覚えた':'意味がわかった';footer=`<div class="rating-buttons${stage==='recall'&&rec.rank==='fair'?' three':''}"><button id="rate-again" class="rating-review" data-action="again">${icon('repeat')}もう一度 <kbd>1</kbd></button>${stage==='recall'&&rec.rank==='fair'?'<button class="rating-fair" data-action="stay-fair">もう少し練習する</button>':''}<button id="rate-right" class="rating-right to-${target}" data-action="right">${icon('check')}${successLabel} <kbd>2</kbd></button></div><p class="card-action-caption">自分の感覚を大切に。ゆっくりで大丈夫。</p>`;}
  el.innerHTML=`<div class="card-topline"><div class="card-kicker"><span class="card-type">${stage==='write'?'WRITE IN HANGUL':stage==='read'?'READ & REMEMBER':reverse?deck.answerKicker:'KOREAN'}</span><span class="card-number">${String(position+1).padStart(2,'0')} / ${String(session.length).padStart(2,'0')}</span></div>${badge(rec.rank)}</div><div class="question-area"><p class="question-guide">${stage==='write'?'このことばのハングルを、書いてみよう。':reverse?`この${deck.answerLabel}にあたる、韓国語は？`:stage==='read'?'このハングルを読んで、意味を思い出そう。':`この韓国語にあたる、${deck.answerLabel}は？`}</p>${questionMarkup(card,reverse)}${stage==='write'&&writeResult===null?`<form id="write-form" class="write-form"><label class="sr-only" for="hangul-input">韓国語の答え</label><input id="hangul-input" placeholder="ハングルを入力" lang="ko" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="writing-note" required></form><p id="writing-note" class="writing-note">${writingChoices.length>1?'登録された表記の、どれかひとつで答えてください。':'登録された韓国語と照合します。空白は判定に含めません。'}</p>`:`<p class="question-helper">${stage==='read'?'READ IT. RECALL IT.':reverse?'THINK IN HANGUL':'TAKE A MOMENT TO REMEMBER'}</p>`}</div>${stage==='write'&&writeResult!==null?`<div class="result-banner${writeResult?'':' wrong'}" role="status">${icon(writeResult?'check':'repeat')}${writeResult?'そのとおり。書けました！':'答えを見て、もう一度覚えよう。'}</div>${submitted?`<p class="write-submission">あなたの答え：<span lang="ko">${esc(submitted)}</span></p>`:''}`:''}${revealed?`<div class="answer-panel">${answerRows(card)}</div>`:''}<div class="card-action-area">${footer}</div>`;
}
function renderComplete(el){const right=[...answers.values()].filter(item=>item.passed).length;const retry=session.filter(card=>answers.get(card.id)?.passed===false);const c=counts();const eligibleNext=stage==='recall'?c.mastered:stage==='read'?c.read:0;const nextStage=stage==='recall'?'read':'write';el.innerHTML=`<div class="complete-state"><div class="complete-mark">${icon('check')}</div><p class="eyebrow">A LITTLE STEP FORWARD</p><h3>ことばが、少し近くなった。</h3><p>${session.length}枚と向き合いました。<br>できた ${right}枚 <span aria-hidden="true">·</span> もう一度 ${session.length-right}枚</p><div class="complete-promotion">${[...new Set([...answers.values()].map(item=>item.rank))].map(id=>badge(id)).join('')}<span style="font-size:9px;color:#9ba99e">今日の一歩を、記録しました。</span></div><div class="complete-actions">${eligibleNext?`<button class="button primary" data-go="${nextStage}">${nextStage==='read'?'読む':'書く'}テストへ ↗</button>`:''}${retry.length?`<button class="button secondary" data-action="retry">もう一度の${retry.length}枚を復習</button>`:''}<button class="button ${eligibleNext?'secondary':'primary'}" data-action="next-set">${stage==='recall'?'次の思い出すテストへ':'次のセットへ'} ↗</button></div></div>`;}
function reveal(){if(!session[position]||revealed||stage==='write')return;revealed=true;renderCard();$('#rate-right')?.focus({preventScroll:true});}
function finishRecall(passed,{stay=false}={}){const card=session[position];if(!card||!revealed||stage==='write')return;let next=stage==='read'?recordReading(record(card),passed):recordRecall(record(card),direction,passed);if(stay)next=setRank(next,'fair');records[card.id]=next;answers.set(card.id,{passed,rank:next.rank});saveRecords();advance();}
function checkWriting(skipped=false){const card=session[position];if(!card||writeResult!==null||composing)return;if(!isEligible(card,record(card),'write')){startSession();toast('今のランクに合わせて、セットを更新しました。');return;}const input=$('#hangul-input');submitted=input?.value.trim()||'';if(!skipped&&!submitted){input?.reportValidity();return;}const passed=!skipped&&(activeDeck==='vocabulary'?matchVocabularyAnswer(submitted,card):matchHangul(submitted,card.han));records[card.id]=recordWriting(record(card),passed);answers.set(card.id,{passed,rank:records[card.id].rank});writeResult=passed;revealed=true;saveRecords();renderOverview();renderCard();$('#next-writing')?.focus({preventScroll:true});}
function advance(){position++;revealed=false;writeResult=null;submitted='';updateStudyChrome();renderOverview();renderCard();($('#reveal-card')||$('#hangul-input')||$('.complete-actions .button'))?.focus({preventScroll:true});}
function setView(next,{hash=true}={}){if(!['study','library','progress'].includes(next))next='study';view=next;$$('.view').forEach(el=>{el.hidden=el.id!==`${view}-view`;});$$('.main-nav [data-view]').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});$('#breadcrumb-view').textContent={study:'学習する',library:'ことば一覧',progress:'記憶のきろく'}[view];if(hash&&location.hash!==`#${view}`)history.replaceState(null,'',`#${view}`);if(view==='library')renderLibrary();}
function renderLibrary(){
  const query=$('#library-search').value.normalize('NFC').trim().toLowerCase();
  const matching=cards.filter(card=>(rankFilter==='all'||rank(card)===rankFilter)&&(!query||[card.han,card.kanji,card.hanja,card.meaning].some(text=>text.normalize('NFC').toLowerCase().includes(query))));
  page=Math.max(0,Math.min(page,Math.ceil(matching.length/pageSize)-1));pageCards=matching.slice(page*pageSize,(page+1)*pageSize);
  const hide=$('#library-hide').checked;
  $('#library-body').innerHTML=pageCards.length?pageCards.map(card=>{
    const id=esc(card.id),r=rank(card),mask=hide&&!revealedRows.has(card.id),hideHan=mask&&direction==='han-ko',hideMean=mask&&direction==='ko-han';
    const accessibleName=hideHan?'このカード':esc(card.han);
    const reveal=`<button class="masked-answer" data-reveal-row="${id}">タップして表示</button>`;
    const options=RANKS.filter(item=>!['read','read2'].includes(item.id)||item.id===r).map(item=>`<option value="${item.id}"${item.id===r?' selected':''}${['read','read2'].includes(item.id)?' disabled':''}>${item.label}</option>`).join('');
    const text=card.kanji||card.meaning||card.hanja;
    const extra=[card.hanja,card.meaning].filter((value,index,array)=>value&&value!==text&&array.indexOf(value)===index);
    return `<tr><td><input type="checkbox" data-select-card="${id}" aria-label="${accessibleName}を選ぶ" ${selected.has(card.id)?'checked':''}></td><td class="han-cell">${hideHan?reveal:`<span lang="ko">${esc(card.han)}</span>`}</td><td class="meaning-cell">${hideMean?reveal:esc(text)+extra.map(value=>`<small>${esc(value)}</small>`).join('')}</td><td><select class="rank-select rank-${r}" data-set-rank="${id}" aria-label="${accessibleName}のランク">${options}</select></td><td><button class="table-queue" data-queue-card="${id}" aria-label="${accessibleName}を次のテストに出す">テストへ ↗</button></td></tr>`;
  }).join(''):'<tr><td colspan="5" style="padding:40px;text-align:center;color:#b1c0ab;font-size:11px">このランクには、まだことばがありません。</td></tr>';
  $('#page-info').textContent=matching.length?`${page*pageSize+1} – ${Math.min((page+1)*pageSize,matching.length)} / ${matching.length}枚`:'0枚';$('#prev-page').disabled=page===0;$('#next-page').disabled=(page+1)*pageSize>=matching.length;
  updateSelection();$('#library-direction').textContent=direction==='ko-han'?`한 → ${getDeck(activeDeck).answerShort}`:`${getDeck(activeDeck).answerShort} → 한`;
}
function updateSelection(){const present=new Set(cards.map(card=>card.id));selected=new Set([...selected].filter(id=>present.has(id)));$('#selection-count').textContent=`${selected.size}枚を選択中`;$('#queue-selected').disabled=!selected.size;$('#select-page').checked=!!pageCards.length&&pageCards.every(card=>selected.has(card.id));$('#select-page').indeterminate=pageCards.some(card=>selected.has(card.id))&&!$('#select-page').checked;}
function queueCards(ids){const selectedCards=cards.filter(card=>ids.has(card.id));selectedCards.forEach(card=>{records[card.id]=setRank(record(card),'manji');});saveRecords();selected.clear();startSession();renderOverview();renderLibrary();toast(`${selectedCards.length}枚を「テスト待ち」に。次のテストに並べました。`);}
function filteredLibrary(id){rankFilter=id;page=0;selected.clear();setView('library');renderOverview();renderLibrary();}
function courseConfig(id){const settings=config.decks?.[id]||{};return {csvUrl:settings.csvUrl||(id==='kanji'?config.csvUrl:'')||'',fallbackCsvUrl:settings.fallbackCsvUrl||(id==='kanji'?config.fallbackCsvUrl:'')||getDeck(id).path};}
async function fetchText(url,deckId){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),config.fetchTimeoutMs||10000);
  try{const target=new URL(url,location.href);if(target.protocol!=='https:'&&target.origin!==location.origin)throw new Error('取得先を確認してください。');const response=await fetch(target,{signal:controller.signal,cache:'no-store',credentials:target.origin===location.origin?'same-origin':'omit'});if(!response.ok)throw new Error('学習データを取得できませんでした。');const text=await response.text();if(text.length>3*1024*1024)throw new Error('学習データを読み込めませんでした。');return {text,...parseDeck(deckId,text)};}finally{clearTimeout(timer);}
}
function restoreRecords(){records=restoreLearningRecords(readJSON(RECORD_KEY,null),readJSON('han-hanja:learning:v2',null),readJSON('han-hanja:progress:v1',{}));saveRecords();}
async function loadCourse(id){const source=courseConfig(id);if(source.csvUrl){try{return await fetchText(source.csvUrl,id);}catch{notice('ことばの更新を確認できなかったため、いつものノートを開きました。');}}return fetchText(source.fallbackCsvUrl,id);}
async function refreshRemote(){
  if(polling||document.visibilityState!=='visible')return;polling=true;
  try{for(const deck of DECKS){const source=courseConfig(deck.id);if(!source.csvUrl)continue;const result=await fetchText(source.csvUrl,deck.id);if(result.text!==deckData.get(deck.id)?.text){deckData.set(deck.id,result);if(deck.id===activeDeck){cards=result.cards;renderOverview();renderLibrary();updateStudyChrome();toast('ことばのノートを更新しました。今のセットはそのまま続けられます。');}}}notice('');}catch{notice('ことばの更新を確認できませんでした。今のノートで学習を続けられます。');}finally{polling=false;}
}
function handleCardAction(action){if(action==='reveal')reveal();else if(action==='right')finishRecall(true);else if(action==='again')finishRecall(false);else if(action==='stay-fair')finishRecall(true,{stay:true});else if(action==='advance')advance();else if(action==='skip-writing')checkWriting(true);else if(action==='reload')location.reload();else if(action==='retry'){
  // Failed read/write cards must relearn before returning to those checkpoints.
  const retries=session.filter(card=>answers.get(card.id)?.passed===false);stage='recall';savePreferences();startSession(retries);
}else if(action==='next-set'){session.forEach(card=>cycleSeen.add(card.id));let remaining=pool().filter(card=>!cycleSeen.has(card.id));if(!remaining.length){cycleSeen.clear();remaining=pool();}startSession(remaining,{continuing:true});}}
function bind(){
  document.addEventListener('click',event=>{const target=event.target.closest('button,a');if(!target)return;if(target.dataset.deck&&loaded)switchDeck(target.dataset.deck);if(target.dataset.view)setView(target.dataset.view);if(target.dataset.stage)setStage(target.dataset.stage);if(target.dataset.go){if(target.dataset.go==='library')setView('library');else setStage(target.dataset.go);}if(target.dataset.action)handleCardAction(target.dataset.action);if(target.dataset.direction){direction=target.dataset.direction;savePreferences();startSession();}if(target.dataset.rankFilter)filteredLibrary(target.dataset.rankFilter);if(target.dataset.rankTile)filteredLibrary(target.dataset.rankTile);if(target.dataset.revealRow){revealedRows.add(target.dataset.revealRow);renderLibrary();}if(target.dataset.queueCard)queueCards(new Set([target.dataset.queueCard]));});
  $('#flashcard').addEventListener('compositionstart',()=>{composing=true;});
  $('#flashcard').addEventListener('compositionend',()=>{composing=false;});
  $('#flashcard').addEventListener('keydown',event=>{if(event.target.id==='hangul-input'&&event.key==='Enter'&&(event.isComposing||composing||event.keyCode===229))event.preventDefault();});
  $('#flashcard').addEventListener('submit',event=>{if(event.target.id==='write-form'){event.preventDefault();if(!composing)checkWriting();}});
  $('#new-session').onclick=()=>{startSession();toast('新しいセットを開きました。');};
  ['session-limit','shuffle'].forEach(id=>$('#'+id).onchange=()=>startSession());
  $('#library-search').oninput=()=>{page=0;renderLibrary();};$('#library-hide').onchange=()=>{revealedRows.clear();renderLibrary();};
  $('#library-direction').onclick=()=>{direction=direction==='ko-han'?'han-ko':'ko-han';savePreferences();revealedRows.clear();renderLibrary();if(loaded)startSession();};
  $('#library-body').onchange=event=>{const el=event.target;if(el.dataset.selectCard){if(el.checked)selected.add(el.dataset.selectCard);else selected.delete(el.dataset.selectCard);updateSelection();}if(el.dataset.setRank){const card=cards.find(item=>item.id===el.dataset.setRank);if(card){records[card.id]=setRank(record(card),el.value);saveRecords();startSession();renderOverview();renderLibrary();toast(`「${rankById.get(el.value).label}」に変更しました。`);}}};
  $('#select-page').onchange=event=>{pageCards.forEach(card=>{if(event.target.checked)selected.add(card.id);else selected.delete(card.id);});renderLibrary();};$('#queue-selected').onclick=()=>queueCards(new Set(selected));
  $('#prev-page').onclick=()=>{page--;renderLibrary();};$('#next-page').onclick=()=>{page++;renderLibrary();};
  $('#choose-targets').onclick=()=>filteredLibrary('all');$('#show-ranks').onclick=()=>setView('progress');
  const showGuide=()=>$('#guide-dialog').showModal();$('#open-guide').onclick=showGuide;$('#guide-from-progress').onclick=showGuide;$('#close-guide').onclick=()=>$('#guide-dialog').close();$('#guide-start').onclick=()=>{$('#guide-dialog').close();setView('study');};
  window.addEventListener('hashchange',()=>setView(location.hash.slice(1),{hash:false}));
  document.addEventListener('keydown',event=>{if(view!=='study'||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||$('#guide-dialog').open)return;const target=event.target;if(target.closest('input,select,textarea,[contenteditable=true]'))return;if(event.code==='Space'&&stage!=='write'&&!revealed&&(!target.closest('button,a')||target.closest('#reveal-card'))){event.preventDefault();reveal();}else if(stage!=='write'&&revealed&&['1','2'].includes(event.key)){event.preventDefault();finishRecall(event.key==='2');}});
}
async function init(){
  $$('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});bind();
  const savedPref=readJSON(PREF_KEY,null),oldPref=readJSON('han-hanja:preferences:v2',{});
  if(savedPref&&savedPref.courses&&typeof savedPref.courses==='object'&&!Array.isArray(savedPref.courses))preferences={courses:{...savedPref.courses}};
  else preferences={courses:{kanji:oldPref&&typeof oldPref==='object'?oldPref:{}}};
  activeDeck=getDeck(savedPref?.deckId||config.defaultDeck).id;
  const pref=preferences.courses[activeDeck]||{};if(['ko-han','han-ko'].includes(pref.direction))direction=pref.direction;if(['recall','read','write'].includes(pref.stage))stage=pref.stage;
  updateCourseChrome();$('#today-date').textContent=new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'short'}).format(new Date());setView(location.hash.slice(1),{hash:false});
  const results=await Promise.allSettled(DECKS.map(deck=>loadCourse(deck.id)));
  results.forEach((result,index)=>{if(result.status==='fulfilled')deckData.set(DECKS[index].id,result.value);});
  if(!deckData.get(activeDeck)&&deckData.size){activeDeck=deckData.keys().next().value;const fallbackPref=preferences.courses[activeDeck]||{};direction=['ko-han','han-ko'].includes(fallbackPref.direction)?fallbackPref.direction:'ko-han';stage=['recall','read','write'].includes(fallbackPref.stage)?fallbackPref.stage:'recall';notice('選んだコースを開けなかったため、別のコースを表示しています。',true);}
  cards=deckData.get(activeDeck)?.cards||[];restoreRecords();loaded=true;startSession();renderLibrary();savePreferences();
  if(!cards.length)notice('学習ノートを開けませんでした。通信を確認して、もう一度試してください。',true);
  if(DECKS.some(deck=>courseConfig(deck.id).csvUrl))setInterval(refreshRemote,config.refreshIntervalMs||60000);
}
init().catch(()=>{loaded=true;notice('画面を開けませんでした。再読み込みしてみてください。',true);renderCard();});
