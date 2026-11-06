import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal } from '../components/Modal';
import { CalendarContent, type DisplaySession } from './CalendarContent';
import { bounds, humanDate, moveReference, today } from './date';
import type { Preview, Term, TimetableView } from './types';

export function SelectionMonthPreview({term,preview,current,onClose}:{term:Term;preview:Preview;current:TimetableView;onClose:()=>void}){
  const courses=[...current.courses.map(c=>({...c,previewSource:'已有课程'})),...preview.courses.map(c=>({...c,previewSource:'本次新增'}))];
  const items:DisplaySession[]=courses.flatMap((c,index)=>c.sessions.map((s,i)=>({...s,entryId:`${c.previewSource}:${c.id}`,courseName:`${c.course_name}（${c.previewSource}）`,teacher:c.teacher||null,index,lessonNumber:s.lesson_number??i+1}))).sort((a,b)=>a.start.localeCompare(b.start));
  const months=[term.startsOn,term.endsOn,...items.map(s=>s.date),...items.map(s=>s.end.slice(0,10))].filter((d):d is string=>Boolean(d)).map(d=>d.slice(0,7)).sort();
  const first=months[0]||today().slice(0,7),last=months.at(-1)||first;
  const thisMonth=today().slice(0,7);
  const initial=thisMonth>=first&&thisMonth<=last?thisMonth:(items[0]?.date.slice(0,7)||first);
  const [month,setMonth]=useState(initial),[day,setDay]=useState<string|null>(null);
  const options:string[]=[];
  for(let m=first;m<=last;m=moveReference('month',m+'-01',1).slice(0,7))options.push(m);
  const [start,end]=bounds('month',month+'-01');
  const count=items.filter(s=>s.start<end!+'T00:00:00+08:00'&&s.end>start!+'T00:00:00+08:00').length;
  const dayItems=day?items.filter(s=>s.start<moveReference('day',day,1)+'T00:00:00+08:00'&&s.end>day+'T00:00:00+08:00'):[];
  function changeMonth(value:string){setMonth(value);setDay(null);}
  return <Modal title="本学期月度课程预览" onClose={onClose}><div className="manage-form selection-month-preview">
    <p className="muted-note">{term.academicYear} · {term.name} · 包含已有课程和本次新增课程，尚未保存。</p>
    <div className="preview-month-toolbar"><button type="button" className="icon-button" aria-label="预览上个月" disabled={month<=first} onClick={()=>changeMonth(moveReference('month',month+'-01',-1).slice(0,7))}><ChevronLeft size={18}/></button><label>查看月份<select value={month} onChange={e=>changeMonth(e.target.value)}>{options.map(m=><option key={m} value={m}>{m.slice(0,4)} 年 {Number(m.slice(5))} 月</option>)}</select></label><button type="button" className="icon-button" aria-label="预览下个月" disabled={month>=last} onClick={()=>changeMonth(moveReference('month',month+'-01',1).slice(0,7))}><ChevronRight size={18}/></button><span>本月共 {count} 次课</span></div>
    {preview.importBlocked&&<p className="feedback" role="alert">{preview.importError||'课程时间重复，请返回调整选择。'}</p>}
    {!!preview.importConflicts?.length&&<div className="feedback" role="alert"><strong>课程时间重复，请返回调整选择。</strong><ul>{preview.importConflicts.map((c,i)=><li key={i}>{c.date} · {c.first} / {c.second} · {c.start.slice(11,16)}{c.end?`—${c.end.slice(11,16)}`:''}</li>)}</ul></div>}
    <CalendarContent view="month" date={month+'-01'} items={items} now={Date.now()} onDate={setDay}/>
    {day&&<section className="preview-day-details" aria-live="polite"><h3>{humanDate(day)} · 当天安排</h3><CalendarContent view="day" date={day} items={dayItems} now={Date.now()} onDate={setDay}/></section>}
    {courses.some(c=>!c.sessions.length)&&<p className="notice">以下课程时间待安排，尚未显示在月历：{courses.filter(c=>!c.sessions.length).map(c=>`${c.course_name}（${c.previewSource}）`).join('、')}。</p>}
    <div className="modal-actions"><button type="button" className="primary-button compact" onClick={onClose}>返回课程选择</button></div>
  </div></Modal>;
}
