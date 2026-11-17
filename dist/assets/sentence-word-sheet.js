import { sentenceWordEntries, renderSentenceWordSheet } from './sentence-view.js?v=12';
import { RATINGS, UNSEEN } from './assessment.js?v=3';

/** Native modal focus trapping, scoped rating edits and example paging. */
export function createSentenceWordSheet({dialog,getContext,onMode,onRating,stopSpeech,onInlineChange=()=>{}}) {
  let selected=null,inline=null;
  const content=dialog.querySelector('#sentence-word-sheet');
  const ratings=new Set([...RATINGS,UNSEEN].map(item=>item.id));
  const render=context=>renderSentenceWordSheet(context.entry,context.words,context.sentences,context.card,context.records,context.mode,selected.page);

  function contextFor(selection) {
    const context=getContext();
    if(!selection || !context.card || context.card.id!==selection.cardId)return null;
    const entry=sentenceWordEntries(context.card,context.words).find(row=>row.key===selection.key);
    return entry?{...context,entry}:null;
  }
  function focusStatus(previous) {
    const context=contextFor(previous);
    if(!context)return;
    const index=sentenceWordEntries(context.card,context.words).findIndex(row=>row.key===previous.key);
    document.querySelector(`[data-sentence-word-status="${index}"]`)?.focus({preventScroll:true});
  }
  function inlineState() {
    return contextFor(inline)?{key:inline.key,feedback:inline.feedback||''}:null;
  }
  function closeInline({focus=true}={}) {
    if(!inline)return;
    const previous=inline;inline=null;onInlineChange();
    if(focus)focusStatus(previous);
  }
  function refresh({focus,resetScroll=false}={}) {
    if(inline && !contextFor(inline))closeInline({focus:false});
    if(!dialog.open)return;
    const context=contextFor(selected);
    if(!context){close();return;}
    const scroll=content.querySelector('.word-sheet-body')?.scrollTop||0;
    content.innerHTML=render(context);
    const body=content.querySelector('.word-sheet-body');
    body.scrollTop=resetScroll?0:scroll;
    if(focus)content.querySelector(focus)?.focus({preventScroll:true});
  }
  function open(index,{status=false}={}) {
    const context=getContext();
    if(!context.card)return;
    const entry=sentenceWordEntries(context.card,context.words)[index];
    if(!entry || status && !entry.word)return;
    stopSpeech();
    if(status) {
      if(dialog.open)dialog.close();
      if(inline?.cardId===context.card.id && inline.key===entry.key){closeInline();return;}
      inline={cardId:context.card.id,key:entry.key};onInlineChange();
      document.querySelector('[data-sentence-word-rating][aria-pressed="true"]')?.focus({preventScroll:true});
      return;
    }
    closeInline({focus:false});
    selected={cardId:context.card.id,key:entry.key,index,page:0};
    // Build the title before showModal so its accessible name is available immediately.
    content.innerHTML=render({...context,entry});
    document.body.classList.add('word-sheet-open');
    dialog.showModal();
    content.querySelector('[data-word-sheet-close]')?.focus({preventScroll:true});
  }
  function close(){closeInline();if(dialog.open)dialog.close();}
  function setMode(mode) {
    if(!['read','write'].includes(mode) || !getContext().card)return;
    if(inline)inline.feedback='';
    stopSpeech();onMode(mode);
    if(dialog.open)refresh({focus:`[data-word-sheet-mode="${mode}"]`});
    else document.querySelector('[data-sentence-word-mode]')?.focus({preventScroll:true});
  }
  function rateInline(rating) {
    const context=contextFor(inline);
    if(!context?.entry.word){closeInline({focus:false});return false;}
    if(!ratings.has(rating))return false;
    if(onRating(context.entry.word.id,context.mode,rating)){closeInline();return true;}
    inline.feedback='保存できませんでした。もう一度お試しください。';onInlineChange();
    document.querySelector(`[data-sentence-word-rating="${rating}"]`)?.focus({preventScroll:true});
    return false;
  }
  dialog.addEventListener('click',event=>{
    if(event.target===dialog){close();return;}
    const button=event.target.closest('button');
    if(!button)return;
    // Speech buttons use the application's single shared player.
    if(button.hasAttribute('data-speak'))return;
    event.stopPropagation();
    if(button.hasAttribute('data-word-sheet-close')){close();return;}
    const context=contextFor(selected);
    if(!context){close();return;}
    if(button.dataset.wordSheetMode){
      setMode(button.dataset.wordSheetMode);
    } else if(button.hasAttribute('data-word-sheet-page')) {
      stopSpeech();selected.page=Number(button.dataset.wordSheetPage);
      const label=button.getAttribute('aria-label');
      refresh({resetScroll:true});
      (content.querySelector(`.word-sheet-pages button[aria-label="${label}"]:not(:disabled)`)||content.querySelector('.word-sheet-pages button:not(:disabled)'))?.focus({preventScroll:true});
    } else if(button.dataset.wordSheetRating && context.entry.word) {
      const rating=button.dataset.wordSheetRating;
      if(onRating(context.entry.word.id,context.mode,rating)) {
        refresh({focus:`[data-word-sheet-rating="${rating}"]`});
        content.querySelector('.word-sheet-feedback').textContent='保存しました';
      } else {
        content.querySelector('.word-sheet-feedback').textContent='保存できませんでした。もう一度お試しください。';
      }
    }
  });
  dialog.addEventListener('close',()=>{
    const previous=selected;selected=null;
    document.body.classList.remove('word-sheet-open');stopSpeech();
    const context=getContext();
    if(previous && context.card?.id===previous.cardId) {
      const entries=sentenceWordEntries(context.card,context.words);
      const index=entries.findIndex(entry=>entry.key===previous.key);
      if(index>=0)document.querySelector(`[data-sentence-word-open="${index}"]`)?.focus({preventScroll:true});
    }
  });
  return {open,close,refresh,inlineState,rateInline,setMode,isOpen:()=>dialog.open||Boolean(inline)};
}
