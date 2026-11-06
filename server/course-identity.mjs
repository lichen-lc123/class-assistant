import {createHash} from 'node:crypto';
import {normalizeCourse,expandCourse} from './schedule.mjs';

export const courseNameKey=value=>String(value||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
export const courseTeacherKey=value=>String(value||'').normalize('NFKC').replace(/\s/g,'').split(/[、,，/；;]+/).filter(Boolean).map(courseNameKey).sort().join('|');
export function courseIdentity(raw,term){
  const course=normalizeCourse(raw,term);
  if(!course.course_name||!course.teacher)return null;
  const expanded=expandCourse(course,term),sessions=expanded.sessions;
  if(expanded.date_reviews?.some(review=>review.action==='pending')||expanded.warnings.some(w=>/周次安排尚缺|未按该规则排课|备注安排缺少唯一/.test(w)))return null;
  if(!sessions.length)return null;
  const times=[...new Set(sessions.map(s=>`${s.date}|${s.start_time}|${s.end_time}`))].sort();
  return createHash('sha256').update(JSON.stringify([term.id,courseNameKey(course.course_name),courseTeacherKey(course.teacher),times])).digest('hex');
}
export function courseTimeLabel(raw,term){
  const sessions=expandCourse(normalizeCourse(raw,term),term).sessions;
  if(!sessions.length)return '上课时间待安排';
  const slots=[...new Set(sessions.map(s=>`星期${'日一二三四五六'[new Date(s.date+'T00:00:00Z').getUTCDay()]} ${s.start_time}—${s.end_time}`))];
  return `${sessions[0].date} 起 · ${slots.join('、')} · ${sessions.length} 次课`;
}
