import {useEffect,useState} from 'react';
import type {Course} from './types';
import {weekdayLabel} from './date';
import {classroomText} from './CalendarContent';

export function CourseSchedule({course}:{course:Course}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[]);
  const sessions=[...course.sessions].sort((a,b)=>a.start.localeCompare(b.start));
  const weekdays=[...new Set(sessions.map(s=>weekdayLabel(s.date)))];
  return <section className="course-schedule-detail" aria-label="全部上课安排">
    <div className="course-schedule-summary"><strong>共 {sessions.length} 次课</strong><span>{weekdays.join('、')}</span>{sessions.length>0&&<p>{sessions[0].date} 至 {sessions.at(-1)!.date}</p>}</div>
    {!sessions.length&&<p className="empty-state">上课时间待安排</p>}
    <ol className="course-session-list">{sessions.map((s,i)=>{const ended=Date.parse(s.end)<=now,ongoing=!ended&&Date.parse(s.start)<=now;return <li key={s.start+':'+i} className={ongoing?'is-current':ended?'is-ended':''}><header><strong>第 {s.lesson_number??i+1} 次课</strong><span>{ongoing?'正在上课':ended?'已结束':'未开始'}</span></header><p className="course-session-date">{s.date} · {weekdayLabel(s.date)}</p><p className="course-session-hours">{s.start_time}—{s.end_time}</p><p>{classroomText(s)}</p><small>{s.week!=null?`第 ${s.week} 教学周`:'教学周次待确认'}</small></li>;})}</ol>
  </section>;
}
