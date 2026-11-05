import {courseWeekdayLabels} from './date';

export function CourseWeekdays({sessions}:{sessions:{date:string}[]}){
  const days=courseWeekdayLabels(sessions);
  return <div className="course-weekdays" aria-label="上课星期">{days.length?days.map(day=><span key={day}>{day}</span>):<span className="weekday-pending">星期待确认</span>}</div>;
}
