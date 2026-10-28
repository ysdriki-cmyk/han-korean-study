import test from 'node:test';
import assert from 'node:assert/strict';
import {createKoreanSpeaker, koreanVoice} from '../dist/assets/speech.js';
import {speechButton} from '../dist/assets/speech-view.js';

const KO = {name:'Korean',lang:'ko-KR',localService:true};
const EN = {name:'English',lang:'en-US',localService:true};
function platform({initialVoices = [KO],autoStart = true,getVoicesError = null,speakError = null,paused = false,...options} = {}) {
  let available = initialVoices;
  const queued = [], states = [], errors = [], errorDetails = [], calls = [], listeners = new Set();
  const synthesis = {
    canceled:0, paused, getVoices() { if (getVoicesError) throw getVoicesError; return available; },
    cancel() { this.canceled += 1; calls.push('cancel'); },
    resume() { this.paused = false; calls.push('resume'); },
    speak(utterance) { calls.push('speak'); if (speakError) throw speakError; queued.push(utterance); if (autoStart) utterance.onstart?.(); },
    addEventListener(type,handler) { if (type === 'voiceschanged') listeners.add(handler); },
    removeEventListener(type,handler) { if (type === 'voiceschanged') listeners.delete(handler); },
  };
  const speaker = createKoreanSpeaker({synthesis,Utterance:class {constructor(text) {this.text=text;this.voice=null;}},onState:state=>states.push(state),onError:(error,details)=>{errors.push(error);errorDetails.push(details);},...options});
  return {speaker,synthesis,queued,states,errors,errorDetails,calls,listeners,setVoices(voices,notify = true) {available=voices;if (notify) for (const handler of [...listeners]) handler();}};
}

test('Korean selection prefers a local ko-KR voice and never falls back to another language', () => {
  const input = [EN,{lang:'ja-JP'},{lang:'ko',localService:true},{lang:'ko_KR',localService:false},KO];
  assert.equal(koreanVoice(input),KO);
  assert.deepEqual(input.map(voice=>voice.lang),['en-US','ja-JP','ko','ko_KR','ko-KR']);
  assert.equal(koreanVoice([EN,{lang:'ja-JP'}]),null);
  for (const lang of ['ko','KO','ko-KP','ko_KR','ko-kr']) {
    const voice = {lang};
    assert.equal(koreanVoice([EN,voice]),voice);
  }
});

test('one character or word is normalized and sent to an explicitly Korean utterance', async () => {
  const p = platform();
  assert.equal(await p.speaker.toggle(' 가 '),true);
  assert.equal(p.queued.length,1);
  assert.equal(p.queued[0].text,'가');
  assert.equal(p.queued[0].lang,'ko-KR');
  assert.equal(p.queued[0].voice,KO);
  assert.equal(p.queued[0].rate,0.9);
  assert.deepEqual(p.states.at(-1),{text:'가',phase:'speaking'});
  p.queued[0].onend();
  assert.deepEqual(p.states.at(-1),{text:'',phase:'idle'});
  assert.deepEqual(p.errors,[]);
});

test('tapping the same word stops it rather than queuing another reading', async () => {
  const p = platform();
  await p.speaker.toggle('한국어');
  assert.equal(await p.speaker.toggle('한국어'),false);
  assert.equal(p.queued.length,1);
  assert.equal(p.queued[0].onerror,null);
  assert.equal(p.states.at(-1).phase,'idle');
});

test('switching words cancels the first, and stale callbacks cannot stop the replacement', async () => {
  const p = platform();
  await p.speaker.toggle('가');
  const lateEnd = p.queued[0].onend, lateError = p.queued[0].onerror;
  await p.speaker.toggle('가격');
  lateEnd(); lateError({error:'interrupted'});
  assert.equal(p.queued.length,2);
  assert.deepEqual(p.states.at(-1),{text:'가격',phase:'speaking'});
  assert.deepEqual(p.errors,[]);
  p.speaker.stop();
});

test('voiceschanged warms Korean selection without speaking before a user tap', () => {
  const p = platform({initialVoices:[]});
  assert.equal(p.listeners.size,1);
  p.setVoices([EN,KO]);
  assert.equal(p.queued.length,0);
  assert.equal(p.speaker.toggle('가족'),true);
  assert.equal(p.queued[0].voice,KO);
  p.speaker.stop();
});

test('an empty or non-Korean voice list still speaks ko-KR synchronously in the click stack', () => {
  for (const initialVoices of [[],[EN,{name:'Japanese',lang:'ja-JP',default:true}]]) {
    const p = platform({initialVoices,autoStart:false});
    let inClick = false;
    const speak = p.synthesis.speak.bind(p.synthesis);
    p.synthesis.speak = utterance => { assert.equal(inClick,true); speak(utterance); };
    inClick = true;
    const result = p.speaker.toggle('가족');
    inClick = false;
    assert.equal(result,true);
    assert.equal(p.queued.length,1);
    assert.equal(p.queued[0].lang,'ko-KR');
    assert.equal(p.queued[0].voice,null);
    assert.equal(p.states.at(-1).phase,'loading');
    assert.deepEqual(p.errors,[]);
    assert.deepEqual(p.calls,['speak']);
    p.speaker.stop();
  }
});

test('late voices never restart or mutate speech; the next tap prefers the Korean voice', () => {
  const p = platform({initialVoices:[],autoStart:false});
  p.speaker.toggle('가족');
  p.setVoices([KO]);
  assert.equal(p.queued.length,1);
  assert.equal(p.queued[0].voice,null);
  p.speaker.stop(); // Navigation stops pending speech even if no start event arrived.
  p.setVoices([KO]);
  assert.equal(p.queued.length,1);
  assert.equal(p.states.at(-1).phase,'idle');
  p.speaker.toggle('가격');
  assert.equal(p.queued[1].voice,KO);
  p.speaker.stop();
});

test('each tap rechecks the voice list even if voiceschanged was never emitted', () => {
  const p = platform({initialVoices:[]});
  p.setVoices([KO],false);
  p.speaker.toggle('한국어');
  assert.equal(p.queued[0].voice,KO);
  p.speaker.stop();
});

test('failure to enumerate voices does not prevent a Korean language-only attempt', () => {
  const p = platform({getVoicesError:new Error('Voice enumeration failed')});
  assert.equal(p.speaker.toggle('가'),true);
  assert.equal(p.queued[0].lang,'ko-KR');
  assert.equal(p.queued[0].voice,null);
  assert.deepEqual(p.errors,[]);
  p.speaker.stop();
});

test('unsupported devices report failure', () => {
  const errors = [];
  assert.equal(createKoreanSpeaker({onError:error=>errors.push(error)}).toggle('가'),false);
  assert.deepEqual(errors,['unsupported']);
});

test('engine errors and silently refused starts both clear the active state', async () => {
  const p = platform();
  await p.speaker.toggle('가다'); p.queued[0].onerror({error:'not-allowed'});
  assert.equal(p.states.at(-1).phase,'idle');
  assert.deepEqual(p.errors,['not-allowed']);
  const silent = platform({autoStart:false,startWaitMs:0});
  await silent.speaker.toggle('가다');
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(silent.states.at(-1).phase,'idle');
  assert.deepEqual(silent.errors,['start-timeout']);
});

test('language-only engine failures retain the actual error code and event for diagnosis', () => {
  for (const error of ['language-unavailable','voice-unavailable','synthesis-failed','not-allowed','network','audio-busy']) {
    const p = platform({initialVoices:[]});
    p.speaker.toggle('가');
    const event = {error,elapsedTime:0,charIndex:0};
    p.queued[0].onerror(event);
    assert.deepEqual(p.errors,[error]);
    assert.deepEqual(p.errorDetails,[{lang:'ko-KR',voice:null,voiceLang:null,error:event}]);
    assert.equal(p.states.at(-1).phase,'idle');
  }
});

test('synchronous speak exceptions are reported and a paused engine resumes before speaking', () => {
  const error = Object.assign(new Error('Speech is blocked'),{name:'NotAllowedError'});
  const p = platform({speakError:error});
  assert.equal(p.speaker.toggle('가'),false);
  assert.deepEqual(p.errors,['NotAllowedError']);
  assert.equal(p.errorDetails[0].error,error);
  assert.equal(p.errorDetails[0].voice,'Korean');
  assert.equal(p.states.at(-1).phase,'idle');
  const paused = platform({paused:true});
  paused.speaker.toggle('가');
  assert.deepEqual(paused.calls,['resume','speak']);
  paused.speaker.stop();
});

test('rapid taps while starting leave only the latest request active and ignore old start events', () => {
  const p = platform({initialVoices:[],autoStart:false});
  p.speaker.toggle('가');
  const lateStart = p.queued[0].onstart, lateError = p.queued[0].onerror;
  assert.equal(p.speaker.toggle('가'),false);
  assert.equal(p.synthesis.canceled,1);
  p.speaker.toggle('가격');
  const lateEnd = p.queued[1].onend;
  p.speaker.toggle('가족');
  lateStart(); lateError({error:'canceled'}); lateEnd();
  assert.deepEqual(p.states.at(-1),{text:'가족',phase:'loading'});
  p.queued[2].onstart();
  assert.deepEqual(p.states.at(-1),{text:'가족',phase:'speaking'});
  p.queued[2].onend();
  assert.equal(p.states.at(-1).phase,'idle');
  assert.deepEqual(p.errors,[]);
});

test('start, end and intentional stop clear the startup watchdog without late errors', async () => {
  const p = platform({startWaitMs:0});
  p.speaker.toggle('가');
  p.queued[0].onend();
  const stopped = platform({initialVoices:[],autoStart:false,startWaitMs:0});
  stopped.speaker.toggle('가격'); stopped.speaker.stop();
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(p.errors,[]);
  assert.deepEqual(stopped.errors,[]);
});

test('speech controls escape source text in attributes and accessible labels', () => {
  const html = speechButton('가"><img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('data-speak="가&quot;&gt;&lt;img'));
  assert.ok(html.includes('aria-pressed="false"'));
  assert.equal(speechButton(' '),'');
});
