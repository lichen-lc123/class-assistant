import {useEffect,useState} from 'react';
import {CalendarContent,type DisplaySession} from './CalendarContent';
import {bounds,shiftDate,today,humanDate} from './date';
export function MobileWeekCalendar({date,items,onCourse}:{date:string;items:DisplaySession[];onCourse:(id:string)=>void}){
  const [selected,setSelected]=useState(date);
  useEffect(()=>setSelected(date),[date]);
  const [monday]=bounds('week',date);
  const onDay=(d:string)=>items.filter(s=>Date.parse(s.start)<Date.parse(shiftDate(d,1)+'T00:00:00+08:00')&&Date.parse(s.end)>Date.parse(d+'T00:00:00+08:00'));
  return <div className="mobile-week-agenda"><div className="mobile-week-strip" role="group" aria-label="选择本周日期">{'一二三四五六日'.split('').map((label,i)=>{const d=shiftDate(monday!,i),lessons=onDay(d);return <button type="button" key={d} aria-pressed={selected===d} className={selected===d?'active':''} onClick={()=>setSelected(d)}><span>周{label}</span><strong>{Number(d.slice(8))}</strong><small>{lessons.length?`${lessons.length}课`:d===today()?'今天':'·'}</small></button>;})}</div><h3>{humanDate(selected)}</h3><CalendarContent view="day" date={selected} items={onDay(selected)} now={Date.now()} onDate={setSelected} onCourse={onCourse}/></div>;
}
