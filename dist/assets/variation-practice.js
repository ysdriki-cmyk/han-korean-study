import { practiceCount } from './practice.js?v=18';

const validLessons=lessons=>Array.isArray(lessons) ? lessons.filter(lesson=>Array.isArray(lesson?.cards) && lesson.cards.length) : [];

/** A family is new only when every sentence has zero attempts in this direction. */
export function unpracticedVariationLessons(lessons, records={}, mode='read') {
  return validLessons(lessons).filter(lesson=>lesson.cards.every(card=>practiceCount(card,records,mode)===0));
}

/** Choose whole families uniformly, keeping their original-to-variation order intact. */
export function randomVariationLesson(lessons, {excludeId='',random=Math.random}={}) {
  const available=validLessons(lessons);
  if(!available.length)return null;
  const alternatives=available.filter(lesson=>lesson.id!==excludeId);
  const candidates=alternatives.length ? alternatives : available;
  const sample=Number((typeof random==='function'?random:Math.random)());
  const unit=Number.isFinite(sample)?Math.max(0,Math.min(sample,1-Number.EPSILON)):0;
  return candidates[Math.floor(unit*candidates.length)];
}
