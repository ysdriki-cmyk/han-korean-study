export const speechText = value => String(value ?? '').normalize('NFC').trim();

/** Never substitute a Japanese or English voice for Korean. */
export function koreanVoice(voices = []) {
  const locale = voice => String(voice.lang || '').replaceAll('_', '-').toLowerCase();
  return [...voices].filter(voice => /^ko(?:-|$)/.test(locale(voice)))
    .sort((a, b) => Number(locale(b) === 'ko-kr') - Number(locale(a) === 'ko-kr') || Number(b.localService === true) - Number(a.localService === true))[0] || null;
}

/** One user-triggered utterance at a time; injected APIs keep lifecycle tests deterministic. */
export function createKoreanSpeaker({ synthesis, Utterance, onState = () => {}, onError = () => {}, voiceWaitMs = 2000, startWaitMs = 10000 } = {}) {
  const supported = !!synthesis && typeof synthesis.speak === 'function' && typeof synthesis.cancel === 'function' && typeof synthesis.getVoices === 'function' && typeof Utterance === 'function';
  let token = 0, activeText = '', current = null, releaseWait = null, watchdog = null;
  const voices = () => { try { return synthesis.getVoices(); } catch { return []; } };
  const state = (text = '', phase = 'idle') => { activeText = text; onState({ text, phase }); };
  function stop() {
    token += 1;
    releaseWait?.(); releaseWait = null;
    clearTimeout(watchdog); watchdog = null;
    if (current) current.onstart = current.onend = current.onerror = null;
    current = null;
    if (supported) { try { synthesis.cancel(); } catch {} }
    state();
  }
  function fail(code, request) {
    if (request !== token) return;
    stop(); onError(code);
  }
  function waitForVoice() {
    return new Promise(resolve => {
      let timer;
      const done = () => {
        clearTimeout(timer); synthesis.removeEventListener?.('voiceschanged', check);
        releaseWait = null; resolve(koreanVoice(voices()));
      };
      const check = () => { if (koreanVoice(voices())) done(); };
      releaseWait = done;
      synthesis.addEventListener?.('voiceschanged', check);
      timer = setTimeout(done, voiceWaitMs);
      check();
    });
  }
  async function toggle(value) {
    const text = speechText(value);
    if (!text) return false;
    if (activeText === text) { stop(); return false; }
    stop();
    const request = ++token;
    if (!supported) { fail('unsupported', request); return false; }
    state(text, 'loading');
    const voice = koreanVoice(voices()) || await waitForVoice();
    if (request !== token) return false;
    if (!voice) { fail('no-korean-voice', request); return false; }
    try {
      const utterance = new Utterance(text); current = utterance;
      utterance.lang = 'ko-KR'; utterance.voice = voice;
      utterance.rate = 0.9; utterance.pitch = 1; utterance.volume = 1;
      utterance.onstart = () => {
        if (request !== token) return;
        clearTimeout(watchdog); watchdog = null; state(text, 'speaking');
      };
      utterance.onend = () => {
        if (request !== token) return;
        token += 1; clearTimeout(watchdog); watchdog = null; current = null; state();
      };
      utterance.onerror = event => fail(event?.error || 'synthesis-failed', request);
      watchdog = setTimeout(() => fail('start-timeout', request), startWaitMs);
      if (synthesis.paused) synthesis.resume?.();
      synthesis.speak(utterance);
      return true;
    } catch { fail('synthesis-failed', request); return false; }
  }
  // Warm the platform's async voice list before the first tap, without speaking.
  if (supported) voices();
  return { toggle, stop, supported };
}
