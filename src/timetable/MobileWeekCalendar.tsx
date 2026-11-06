import {classroomText,type DisplaySession} from './CalendarContent';
import {bounds,shiftDate,today} from './date';
export function MobileWeekCalendar({date,items,onCourse}:{date:string;items:DisplaySession[];onCourse:(id:string)=>void}){
  const [monday]=bounds('week',date);
  const current=today();
  return <section className="phone-week-overview" aria-label="整周课程"><p className="phone-week-range">{monday} — {shiftDate(monday!,6)}</p>{'一二三四五六日'.split('').map((label,i)=>{
    const d=shiftDate(monday!,i);
    const lessons=items.filter(s=>Date.parse(s.start)<Date.parse(shiftDate(d,1)+'T00:00:00+08:00')&&Date.parse(s.end)>Date.parse(d+'T00:00:00+08:00')).sort((a,b)=>a.start.localeCompare(b.start));
    return <section key={d} className={`phone-week-day ${d===current?'is-today':''} ${!lessons.length?'is-empty':''}`} aria-label={d+' 星期'+label}><header><strong>周{label}</strong><time dateTime={d}>{d.slice(5).replace('-','/')}</time>{d===current&&<small>今天</small>}</header><div className="phone-week-lessons">{lessons.length?lessons.map((lesson,j)=><button type="button" key={lesson.entryId+lesson.start+j} className={`phone-week-course tone-${lesson.index%4}`} onClick={()=>onCourse(lesson.entryId)}><strong>{lesson.courseName}</strong><span className="phone-week-course-time">{lesson.start_time}—{lesson.end_time}</span><span className="phone-week-course-room">{classroomText(lesson)}</span></button>):<p>无课</p>}</div></section>;
  })}</section>;
}
