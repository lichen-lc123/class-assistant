import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { Modal } from '../components/Modal';
import {dateWeek,dateWeekday,lessonTitle,newCardLesson,numberCardLessons} from './card-lessons';
import {chronologicalLessons} from '../../shared/lesson-order.mjs';
import { type CourseData, type Term, type WeeklyRule, type SpecialDate, type ExplicitSession, type WeeklyDateResolution } from './types';

export function SessionsEditor({value,onChange,term}:{value:ExplicitSession[];onChange:(v:ExplicitSession[])=>void;term:Term}){
  const list=useRef<HTMLDivElement>(null),adding=useRef<number|null>(null),keys=useRef(new WeakMap<ExplicitSession,number>()),nextKey=useRef(0);
  const keyFor=(session:ExplicitSession)=>{let key=keys.current.get(session);if(key===undefined){key=nextKey.current++;keys.current.set(session,key);}return key;};
  const ordered=chronologicalLessons(value);
  function publish(lessons:ExplicitSession[]){const sorted=chronologicalLessons(lessons),numbered=numberCardLessons(sorted);numbered.forEach((s,i)=>keys.current.set(s,keyFor(sorted[i])));onChange(numbered);}
  useLayoutEffect(()=>{
    if(adding.current===null)return;const key=adding.current;adding.current=null;
    const area=list.current,card=area?.querySelector<HTMLElement>('[data-lesson-key="'+key+'"]');
    if(!area||!card)return;
    area.scrollTo({top:area.scrollTop+card.getBoundingClientRect().top-area.getBoundingClientRect().top-8,behavior:'auto'});
    card.querySelector<HTMLInputElement>('input[type="date"]')?.focus({preventScroll:true});
  },[value.length]);
  const update=(target:ExplicitSession,patch:Partial<ExplicitSession>)=>{const changed={...target,...patch};keys.current.set(changed,keyFor(target));publish(value.map(s=>s===target?changed:s));};
  return <div className="schedule-fields shared-lesson-editor"><div className="mini-heading"><strong>具体上课安排 · {value.length} 次课</strong><button className="text-button" type="button" disabled={value.length>=200} onClick={()=>{const added=newCardLesson(ordered);adding.current=keyFor(added);publish([...value,added]);}}><Plus size={14}/>新增一次课</button></div>
    {!value.length&&<p className="muted-note">没有明确日期时可先保留待安排，不必填写猜测的时间。</p>}
    <p className="muted-note">按上课日期和开始时间正序编号，新增、改期或删除后自动重新排序。</p>
    <div className="shared-lesson-scroll" ref={list}>{ordered.map((s,i)=><section className="lesson-editor-card" key={keyFor(s)} data-lesson-key={keyFor(s)}>
      <div className="mini-heading"><h3>{lessonTitle(i+1)}</h3><button className="text-button danger-text" type="button" aria-label={'移除第'+(i+1)+'次课'} onClick={()=>publish(value.filter(item=>item!==s))}><X size={16}/>删除</button></div>
      <div className="lesson-editor-fields">
        <label>第几次课<input readOnly value={i+1}/></label>
        <label>上课日期<input aria-label={'第'+(i+1)+'次日期'} type="date" value={s.date} required onChange={e=>update(s,{date:e.target.value,week:dateWeek(e.target.value,term),weekday:dateWeekday(e.target.value)})}/></label>
        <label>上课周次<input readOnly value={dateWeek(s.date,term)??s.week??''} placeholder={s.date?'校历周次待确认':'选择日期后自动生成'}/></label>
        <label>星期<input readOnly value={dateWeekday(s.date)?'星期'+'一二三四五六日'[dateWeekday(s.date)!-1]:''} placeholder="选择日期后自动生成"/></label>
        <label className="lesson-room">地点<input value={s.room||''} placeholder={s.kind==='practice'?'实践活动不在教室':'可待通知'} disabled={s.kind==='practice'} onChange={e=>update(s,{room:e.target.value})}/></label>
        <label>上课开始时间<input type="time" value={s.start_time} required onChange={e=>update(s,{start_time:e.target.value})}/></label>
        <label>上课结束时间<input type="time" value={s.end_time} required onChange={e=>update(s,{end_time:e.target.value})}/></label>
        <label>类型<select value={s.kind||'lecture'} onChange={e=>update(s,{kind:e.target.value,room:e.target.value==='practice'?null:s.room})}><option value="lecture">课堂教学</option><option value="practice">实践活动</option></select></label>
      </div>
    </section>)}</div>
  </div>;
}
export function CourseEditor({course,term,onClose,onSave,busy=false,extra,error,title}:{course:CourseData;term:Term;onClose:()=>void;onSave:(c:CourseData)=>void;busy?:boolean;extra?:ReactNode;error?:string;title?:string}){
  const [value,setValue]=useState<CourseData>(()=>({...structuredClone(course),explicit_sessions:numberCardLessons(course.explicit_sessions)}));
  const [weeksText,setWeeksText]=useState(()=>course.weekly_rules.map(r=>r.weeks.join(',')));
  const resolutions=(Array.isArray(value.extra_fields?.['周次日期冲突处理'])?value.extra_fields!['周次日期冲突处理']:[]) as WeeklyDateResolution[];
  const originalResolutions=Array.isArray(course.extra_fields?.['周次日期冲突处理'])?course.extra_fields!['周次日期冲突处理']:[];
  const update=(patch:Partial<CourseData>)=>setValue(v=>({...v,...patch,...((patch.weekly_rules||patch.special_dates)&&Array.isArray(v.extra_fields?.['周次日期冲突处理'])?{extra_fields:{...v.extra_fields,...patch.extra_fields,'周次日期冲突处理':[]}}:{})}));
  const weekly=(i:number,patch:Partial<WeeklyRule>)=>update({weekly_rules:value.weekly_rules.map((r,j)=>i===j?{...r,...patch}:r)});
  const special=(i:number,patch:Partial<SpecialDate>)=>update({special_dates:value.special_dates.map((r,j)=>i===j?{...r,...patch}:r)});
  function submit(e:FormEvent){e.preventDefault();onSave({...value,academic_year:term.academicYear,semester:term.name});}
  return <Modal title={title||(course.course_name?'校对课程信息':'添加课程')} onClose={onClose} busy={busy}><form className="manage-form wide-form" onSubmit={submit}>
    <p className="muted-note">{term.academicYear} · {term.name}。先核对课程名称、教师及上课时间。周次与明确日期采用并集，不要求同时填写；日期跨季或跨年仍保留。</p>
    <div className="form-grid"><label>课程名称<input required maxLength={120} value={value.course_name} onChange={e=>update({course_name:e.target.value})}/></label><label>老师<input value={value.teacher||''} onChange={e=>update({teacher:e.target.value})}/></label><label>课程编号<input value={value.course_code||''} onChange={e=>update({course_code:e.target.value})}/></label><label>默认上课地点<input value={value.room||''} onChange={e=>update({room:e.target.value})}/></label></div>
    <div className="schedule-fields"><div className="mini-heading"><strong>按周上课规则</strong><button type="button" className="text-button" onClick={()=>{update({weekly_rules:[...value.weekly_rules,{weeks:[],weekday:1,calendar_name:term.config.calendars[0]?.name||null}]});setWeeksText([...weeksText,'']);}}><Plus size={14}/>添加规则</button></div>
      {value.weekly_rules.map((r,i)=><fieldset key={i}><legend>规则 {i+1}</legend><div className="form-grid"><label>上课周次<input value={weeksText[i]||''} placeholder="例如 5,7,9,11；未知留空" onChange={e=>{const input=e.target.value;setWeeksText(weeksText.map((v,j)=>i===j?input:v));weekly(i,{weeks:input.split(/[,，、\s]+/).filter(Boolean).map(Number)});}}/></label><label>星期<select value={r.weekday||''} onChange={e=>weekly(i,{weekday:e.target.value?Number(e.target.value):null})}><option value="">待确认</option>{['一','二','三','四','五','六','日'].map((d,j)=><option value={j+1} key={d}>星期{d}</option>)}</select></label><label>教学周日历<select value={r.calendar_name||''} onChange={e=>weekly(i,{calendar_name:e.target.value||null})}><option value="">未指定 / 待配置</option>{r.calendar_name&&!term.config.calendars.some(c=>c.name===r.calendar_name)&&<option value={r.calendar_name}>{r.calendar_name}（尚未配置）</option>}{term.config.calendars.map(c=><option key={c.name}>{c.name}</option>)}</select></label><label>地点<input value={r.room||''} onChange={e=>weekly(i,{room:e.target.value})}/></label><label>开始节次<input type="number" min="1" max="30" value={r.period_start||''} onChange={e=>weekly(i,{period_start:Number(e.target.value)||null})}/></label><label>结束节次<input type="number" min="1" max="30" value={r.period_end||''} onChange={e=>weekly(i,{period_end:Number(e.target.value)||null})}/></label><label>或明确开始时刻<input type="time" value={r.start_time||''} onChange={e=>weekly(i,{start_time:e.target.value||null})}/></label><label>或明确结束时刻<input type="time" value={r.end_time||''} onChange={e=>weekly(i,{end_time:e.target.value||null})}/></label></div><button type="button" className="text-button danger-text" onClick={()=>{update({weekly_rules:value.weekly_rules.filter((_,j)=>j!==i)});setWeeksText(weeksText.filter((_,j)=>j!==i));}}>移除此规则</button></fieldset>)}
    </div>
    {!!resolutions.length&&<details className="review-issues" open><summary>已明确的周次与日期冲突</summary>{resolutions.map((resolution,i)=><div className="date-resolution-row" key={i}><strong>{resolution.date} · 采用周次安排</strong><p>{resolution.reason}</p><button type="button" className="text-button" disabled={busy} onClick={()=>update({extra_fields:{...value.extra_fields,'周次日期冲突处理':resolutions.filter((_,j)=>j!==i)}})}>取消此冲突标记，重新计算该日期</button></div>)}</details>}
    {!!originalResolutions.length&&!resolutions.length&&<p className="notice">原冲突标记已取消，将按当前周次与日期重新计算。</p>}
    <SessionsEditor term={term} value={value.explicit_sessions} onChange={explicit_sessions=>update({explicit_sessions})}/>
    <div className="schedule-fields"><div className="mini-heading"><strong>备注中的明确日期、补课、调课与实践</strong><button type="button" className="text-button" onClick={()=>update({special_dates:[...value.special_dates,{date:null,kind:'supplement'}]})}><Plus size={14}/>添加日期安排</button></div>
      {value.special_dates.map((s,i)=><fieldset key={i}><legend>备注安排 {i+1}</legend><div className="form-grid"><label>日期<input type="date" value={s.date||''} onChange={e=>special(i,{date:e.target.value||null})}/></label><label>原文星期（可留空）<select value={s.weekday||''} onChange={e=>special(i,{weekday:e.target.value?Number(e.target.value):null})}><option value="">未提供</option>{['一','二','三','四','五','六','日'].map((day,j)=><option value={j+1} key={day}>星期{day}</option>)}</select></label><label>类型<select value={s.kind} onChange={e=>special(i,{kind:e.target.value,room:e.target.value==='practice'?null:s.room})}><option value="lecture">明确上课日期</option><option value="supplement">补充课次</option><option value="practice">实践活动</option><option value="reschedule">调课</option><option value="unknown">类型待确认</option></select></label><label>第几次课<input type="number" min="1" max="200" value={s.lesson_number||''} onChange={e=>special(i,{lesson_number:Number(e.target.value)||null})}/></label>{s.kind==='reschedule'&&<label>原上课日期<input type="date" value={s.original_date||''} onChange={e=>special(i,{original_date:e.target.value||null})}/></label>}<label>开始时刻<input type="time" value={s.start_time||''} onChange={e=>special(i,{start_time:e.target.value||null})}/></label><label>结束时刻<input type="time" value={s.end_time||''} onChange={e=>special(i,{end_time:e.target.value||null})}/></label><label>地点<input disabled={s.kind==='practice'} value={s.room||''} placeholder={s.kind==='practice'?'不在教室授课':'可沿用已确认的安排'} onChange={e=>special(i,{room:e.target.value})}/></label></div><p className="muted-note">{s.raw||'未填写时刻时，仅在能从原安排唯一确定时间时沿用。'}</p><button type="button" className="text-button danger-text" onClick={()=>update({special_dates:value.special_dates.filter((_,j)=>i!==j)})}>移除此安排</button></fieldset>)}
    </div>
    <details><summary>原始上课信息与备注</summary><label>上课原文<textarea rows={3} value={value.schedule_raw||''} onChange={e=>update({schedule_raw:e.target.value})}/></label><label>备注原文<textarea rows={3} value={value.remarks_raw||''} onChange={e=>update({remarks_raw:e.target.value})}/></label><p className="muted-note">修改原文不会自动排课，请通过上面的规则或日期调整安排。</p></details>
    {extra}{error&&<p role="alert" className="feedback">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button compact" disabled={busy}>保存并重新检查</button></div>
  </form></Modal>;
}
