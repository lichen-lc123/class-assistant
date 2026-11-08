import type { CourseData, Course, ExplicitSession, Term } from './types';
import {courseTeachingWeek} from '../../shared/course-week.mjs';

export function dateWeekday(date:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const day=new Date(`${date}T00:00:00Z`);
  return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===date?day.getUTCDay()||7:null;
}
export function dateWeek(date:string,term:Term):number|null{
  if(!dateWeekday(date))return null;
  return courseTeachingWeek(date,{},term);
}
export function numberCardLessons<T extends ExplicitSession>(lessons:T[]):T[]{
  return lessons.map((lesson,index)=>({...lesson,lesson_number:index+1}));
}
export function newCardLesson(lessons:ExplicitSession[]):ExplicitSession{
  const first=lessons[0];
  return {lesson_number:lessons.length+1,date:'',week:null,weekday:null,room:first?.room||'',start_time:first?.start_time||'',end_time:first?.end_time||'',kind:'lecture'};
}
export function lessonTitle(n:number){
  if(!Number.isInteger(n)||n<1||n>200)return '课次待填写';
  const digits=['零','一','二','三','四','五','六','七','八','九'];
  const label=n<10?digits[n]:n<20?'十'+(n%10?digits[n%10]:''):n<100?digits[Math.floor(n/10)]+'十'+(n%10?digits[n%10]:''):String(n);
  return `第${label}次课`;
}
export function cardLessons(course:CourseData,term:Term):ExplicitSession[]{
  const expanded=(course as Course).sessions;
  return (expanded||course.explicit_sessions).map((s,i)=>({...s,lesson_number:s.lesson_number||i+1,week:s.week??course.explicit_sessions.find(e=>e.date===s.date&&e.start_time===s.start_time)?.week??dateWeek(s.date,term)}));
}
// Keep incomplete source arrangements; replacing resolved rules prevents an old
// weekly date from reappearing after a lesson is moved or removed in the editor.
export function replaceCardLessons(course:CourseData,lessons:ExplicitSession[],term:Term):CourseData{
  const weekly_rules=course.weekly_rules.flatMap(r=>{
    const calendar=r.calendar_name?[...term.config.calendars,...(term.config.sourceCalendars||[])].find(c=>c.name===r.calendar_name):term.config.calendars.length===1?term.config.calendars[0]:null;
    const start=r.start_time||term.config.periods.find(p=>p.number===r.period_start)?.start;
    const end=r.end_time||term.config.periods.find(p=>p.number===r.period_end)?.end;
    if(!calendar||!r.weeks.length||!r.weekday||!start||!end||start===end)return [r];
    const weeks=r.weeks.filter(week=>{
      const date=new Date(Date.parse(calendar.start_date+'T00:00:00Z')+((week-1)*7+r.weekday!-(dateWeekday(calendar.start_date)||1))*86400000).toISOString().slice(0,10);
      return calendar.end_date&&date>calendar.end_date;
    });
    return weeks.length?[{...r,weeks}]:[];
  });
  const reviews=(course as Course).date_reviews||[];
  const special_dates=course.special_dates.filter(s=>!s.date||reviews.some(r=>r.action==='pending'&&r.date===s.date));
  const extra_fields={...course.extra_fields};
  delete extra_fields['周次日期冲突处理'];
  return {...course,room:null,weekly_rules,special_dates,explicit_sessions:lessons.map(s=>({...s,weekday:dateWeekday(s.date)})),extra_fields};
}
