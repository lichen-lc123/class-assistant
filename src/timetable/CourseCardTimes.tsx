import {Clock3} from 'lucide-react';
import type {Session} from './types';
import {CourseWeekdays} from './CourseWeekdays';

export function CourseCardTimes({sessions}:{sessions:Session[]}){
  const times=[...new Map(sessions.map(session=>[`${session.start_time}-${session.end_time}`,session])).values()];
  return <><CourseWeekdays sessions={sessions}/><div className="course-card-times" aria-label="上课时间"><Clock3 size={15}/><div>{times.length?times.map(session=><span key={`${session.start_time}-${session.end_time}`}><time dateTime={session.start_time}>{session.start_time}</time>-<time dateTime={session.end_time}>{session.end_time}</time>{session.end_time<session.start_time&&<small>（次日结束）</small>}</span>):<span className="card-time-pending">上课时间待安排</span>}</div></div></>;
}
