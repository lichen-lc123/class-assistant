import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../components/Modal';
import { cardLessons, dateWeek, dateWeekday, lessonTitle, newCardLesson, numberCardLessons, replaceCardLessons } from './card-lessons';
import type { CourseData, ExplicitSession, Term } from './types';

export function CardCourseEditor({course,term,onClose,onSave,busy=false,extra,error,title='编辑卡片模板'}:{course:CourseData;term:Term;onClose:()=>void;onSave:(course:CourseData)=>void;busy?:boolean;extra?:ReactNode;error?:string;title?:string}){
  const [name,setName]=useState(course.course_name),[teacher,setTeacher]=useState(course.teacher||'');
  const [lessons,setLessons]=useState<(ExplicitSession&{key:number})[]>(()=>numberCardLessons(cardLessons(course,term).sort((a,b)=>(a.lesson_number||201)-(b.lesson_number||201)).map((s,i)=>({...s,week:dateWeek(s.date,term)??s.week??null,key:i}))));
  const nextKey=useRef(lessons.length),scrollArea=useRef<HTMLDivElement>(null);
  const [addedKey,setAddedKey]=useState<number|null>(null);
  useLayoutEffect(()=>{
    if(addedKey===null)return;
    const area=scrollArea.current,card=area?.querySelector<HTMLElement>('[data-lesson-key="'+addedKey+'"]');
    if(!area||!card)return;
    area.scrollTo({top:area.scrollTop+card.getBoundingClientRect().top-area.getBoundingClientRect().top-8,behavior:'auto'});
    card.querySelector<HTMLInputElement>('input[type="date"]')?.focus({preventScroll:true});
  },[addedKey]);
  function update(key:number,patch:Partial<ExplicitSession>){setLessons(old=>old.map(s=>s.key===key?{...s,...patch}:s));}
  function add(){const key=nextKey.current++;setLessons(old=>[...old,{...newCardLesson(old),key}]);setAddedKey(key);}
  function submit(e:FormEvent){
    e.preventDefault();if(busy)return;
    const clean=numberCardLessons(lessons).map(({key,...s})=>s);
    const value=replaceCardLessons(course,clean,term);
    onSave({...value,course_name:name,teacher,academic_year:term.academicYear,semester:term.name});
  }
  const remaining=replaceCardLessons(course,[],term);
  return <Modal title={title} onClose={onClose} busy={busy}><form className="manage-form wide-form card-course-editor" onSubmit={submit}>
    <div className="card-course-editor-header">
      <div className="form-grid"><label>课程名称<input required maxLength={120} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label><label>老师<input value={teacher} disabled={busy} onChange={e=>setTeacher(e.target.value)}/></label></div>
      <div className="mini-heading lesson-list-heading"><strong>上课安排 · {lessons.length} 次课</strong><button type="button" className="secondary-button" disabled={busy||lessons.length>=200} onClick={add}><Plus size={16}/>新增课堂</button></div>
    </div>
    <div className="card-course-scroll manage-form" ref={scrollArea}>
    {!lessons.length&&<p className="muted-note">暂无明确的上课安排，点击右上角“新增课堂”添加。</p>}
    <div className="lesson-editor-list">{lessons.map((s,index)=><section className="lesson-editor-card" key={s.key} data-lesson-key={s.key}>
      <div className="mini-heading"><h3>{lessonTitle(index+1)}</h3><button type="button" className="text-button danger-text" disabled={busy} aria-label={'删除第'+(index+1)+'次课'} onClick={()=>setLessons(old=>numberCardLessons(old.filter(item=>item.key!==s.key)))}><Trash2 size={15}/>删除</button></div>
      <div className="lesson-editor-fields">
        <label>第几次课<input readOnly value={index+1}/></label>
        <label>上课日期<input type="date" required disabled={busy} value={s.date} onChange={e=>update(s.key,{date:e.target.value,week:dateWeek(e.target.value,term),weekday:dateWeekday(e.target.value)})}/></label>
        <label>上课周次<input readOnly value={s.week??''} placeholder={s.date?'校历周次待确认':'选择日期后自动生成'}/></label>
        <label>星期<input readOnly value={dateWeekday(s.date)?'星期'+['一','二','三','四','五','六','日'][dateWeekday(s.date)!-1]:''} placeholder="选择日期后自动生成"/></label>
        <label className="lesson-room">地点<input maxLength={120} disabled={busy||s.kind==='practice'} value={s.room||''} placeholder={s.kind==='practice'?'实践活动 · 不在教室授课':'地点待通知'} onChange={e=>update(s.key,{room:e.target.value})}/></label>
        <label>上课开始时间<input type="time" required disabled={busy} value={s.start_time} onChange={e=>update(s.key,{start_time:e.target.value})}/></label>
        <label>上课结束时间<input type="time" required disabled={busy} value={s.end_time} onChange={e=>update(s.key,{end_time:e.target.value})}/></label>
      </div>
    </section>)}</div>
    {(remaining.weekly_rules.length>0||remaining.special_dates.length>0)&&<p className="notice">还有尚未明确日期或时间的原始安排，保存时将继续保留。请对照导入内容核对。</p>}
    <p className="muted-note">课次自动连续编号，周次与星期随日期生成；校历未覆盖或存在歧义时，周次标为待确认。新增课堂默认沿用第一节课的地点和起止时间，可单独调整。</p>
    {extra}{error&&<p role="alert" className="feedback">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button compact" disabled={busy}>{busy?'正在保存…':'保存并重新检查'}</button></div>
    </div>
  </form></Modal>;
}
