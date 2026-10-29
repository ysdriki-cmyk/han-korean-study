/** The supplied sheet's F column is normalized as card.kanji. */
export function essentialKanji(card) {
  if (typeof card?.essential === 'boolean') return card.essential;
  return Boolean(String(card?.kanji ?? '').trim());
}

const OPEN = new Map([['（', 'paren'], ['(', 'paren'], ['「', 'quote'], ['『', 'title'], ['【', 'square'], ['[', 'square']]);
const CLOSE = new Map([['）', 'paren'], [')', 'paren'], ['」', 'quote'], ['』', 'title'], ['】', 'square'], [']', 'square']]);
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7ff]/gu;
const SEPARATOR = /[、,\n\r／/・·;；]/u;
const clean = value => String(value ?? '').normalize('NFC').trim();

function whollyWrapped(value) {
  const kind = OPEN.get(value[0]);
  if (!kind || CLOSE.get(value.at(-1)) !== kind) return false;
  const stack = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (OPEN.has(char)) stack.push(OPEN.get(char));
    else if (CLOSE.has(char)) {
      if (stack.pop() !== CLOSE.get(char)) return false;
      if (!stack.length && index !== value.length - 1) return false;
    }
  }
  return !stack.length;
}

/**
 * Extract alternatives while preserving qualifiers such as
 * （口笛、楽器などを）吹く. The sheet's 〔…다〕 blocks form a second
 * group of alternatives; Hangul annotations never become a reverse hint.
 * This helper also supports the I-column fallback for the optional full set.
 */
export function splitKanjiHints(text) {
  const hints = [];
  let token = '';
  const stack = [];
  const flush = () => {
    let hint = clean(token.replace(HANGUL, ''));
    token = '';
    while (whollyWrapped(hint)) hint = hint.slice(1, -1).trim();
    if (hint && !hints.includes(hint)) hints.push(hint);
  };
  for (const char of clean(text)) {
    if ((char === '〔' || char === '〕') && !stack.length) {
      flush();
    } else if (OPEN.has(char)) {
      // Adjacent quoted alternatives: 「食事を抜く」「絶食する」.
      if (!stack.length && /[」』]$/u.test(token)) flush();
      stack.push(OPEN.get(char));
      token += char;
    } else if (CLOSE.has(char)) {
      if (stack.at(-1) === CLOSE.get(char)) stack.pop();
      token += char;
    } else if (!stack.length && SEPARATOR.test(char)) {
      flush();
    } else token += char;
  }
  flush();
  return hints;
}

/** F-column hints only. Required membership never falls back to I or J. */
export function kanjiHints(card) {
  return splitKanjiHints(card?.kanji);
}

/** A stable index lets callers rotate one hint on later appearances. */
export function kanjiPrompt(card, seed = 0) {
  const hints = kanjiHints(card);
  if (!hints.length) return '';
  const index = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  return hints[((index % hints.length) + hints.length) % hints.length];
}

/** Prefer the required F-column clues; full-set cards can use I or J. */
export function kanjiPromptChoices(card) {
  const hints = kanjiHints(card);
  return hints.length ? hints : splitKanjiHints(clean(card?.hanja) || card?.meaning);
}

/**
 * One visible clue can have several correct Korean correspondences (女: 녀/여).
 * Compare the complete visible clue, never a substring or a guessed synonym.
 */
export function kanjiAnswersForPrompt(cards, prompt) {
  const clue = clean(prompt);
  if (!clue) return [];
  const answers = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    const han = clean(card?.han);
    if (han && kanjiPromptChoices(card).includes(clue) && !answers.includes(han)) answers.push(han);
  }
  return answers;
}
