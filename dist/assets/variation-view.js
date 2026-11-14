import { speechButton } from './speech-view.js';

const clean = value => String(value ?? '').normalize('NFC').trim();
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

/** Highlight changed characters while preserving complete, escaped source text. */
export function variationDifference(before, after) {
  const left = [...clean(before)], right = [...clean(after)];
  const unchangedLeft = new Set(), unchangedRight = new Set();
  if (left.length * right.length <= 250000) {
    const lengths = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
      lengths[i][j] = left[i] === right[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) { unchangedLeft.add(i++); unchangedRight.add(j++); }
      else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
      else j++;
    }
  } else {
    let prefix = 0;
    while (prefix < Math.min(left.length, right.length) && left[prefix] === right[prefix]) {
      unchangedLeft.add(prefix); unchangedRight.add(prefix++);
    }
    let suffix = 0;
    while (suffix < Math.min(left.length, right.length) - prefix && left[left.length - suffix - 1] === right[right.length - suffix - 1]) {
      unchangedLeft.add(left.length - suffix - 1); unchangedRight.add(right.length - ++suffix);
    }
  }
  const markup = (characters, unchanged, kind) => {
    let result = '', marked = false;
    characters.forEach((character, index) => {
      const changed = !unchanged.has(index);
      if (changed !== marked) { result += changed ? `<mark class="variation-${kind}">` : '</mark>'; marked = changed; }
      result += esc(character);
    });
    return result + (marked ? '</mark>' : '');
  };
  return { before: markup(left, unchangedLeft, 'before'), after: markup(right, unchangedRight, 'after') };
}

/** Only the base may be offered as a hint; the current answer stays hidden. */
export function renderVariationPrompt(lesson, position, { mode = 'write' } = {}) {
  const card = lesson?.cards?.[position];
  if (!card) return '';
  const metadata = card.variation || {}, base = lesson.baseCard;
  const combined = /組み合わせ|応用|まとめ|自力/u.test(metadata.type || '');
  const context = [metadata.speechStyle, metadata.audience].map(clean).filter(Boolean).join(' · ');
  const hint = position > 0 && base && clean(base.han) !== clean(card.han)
    ? `<details class="variation-base"${combined ? '' : ' open'}><summary>元の文${combined ? 'を見る' : ''}</summary><p lang="ko">${esc(base.han)}${speechButton(base.han)}</p>${mode === 'write' ? `<span>${esc(base.kanji)}</span>` : ''}</details>` : '';
  const instruction = mode === 'write' ? metadata.instruction || '日本語を韓国語で表してみましょう。' : '文の意味を答えてみましょう。';
  return `<section class="variation-prompt" aria-label="変形の練習"><div class="variation-step"><span>${position + 1} / ${lesson.cards.length}</span><strong>${esc(metadata.type || (position === 0 ? '基本の文' : '変形'))}</strong></div><p class="variation-instruction">${esc(instruction)}</p>${context ? `<p class="variation-context">${esc(context)}</p>` : ''}${hint}</section>`;
}

/** Comparison, editing notes and accepted answers appear after recall only. */
export function renderVariationAnswer(card, base) {
  if (!card) return '';
  const metadata = card.variation || {};
  const different = base && clean(base.han) !== clean(card.han);
  const difference = different ? variationDifference(base.han, card.han) : null;
  const alternatives = [...new Set((metadata.answerVariants || []).map(clean).filter(value => value && value !== clean(card.han)))];
  const notes = [metadata.point, metadata.usageNote].map(clean).filter(Boolean);
  if (!different && !notes.length && !alternatives.length) return '';
  return `<section class="variation-answer" aria-label="変化の確認">${different ? `<div class="variation-comparison"><div><span>元の文</span><p lang="ko">${difference.before}</p></div><div><span>今回の文</span><p lang="ko">${difference.after}</p></div></div>` : ''}${notes.map(note => `<p class="variation-note">${esc(note)}</p>`).join('')}${alternatives.length ? `<div class="variation-alternatives"><span>このお題で使える別の表現</span>${alternatives.map(value => `<p lang="ko">${esc(value)}${speechButton(value)}</p>`).join('')}</div>` : ''}</section>`;
}
