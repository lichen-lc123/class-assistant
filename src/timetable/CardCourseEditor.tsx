import { useState, type FormEvent, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../components/Modal';
import { cardLessons, dateWeek, dateWeekday, lessonTitle, replaceCardLessons } from './card-lessons';
import type { CourseData, ExplicitSession, Term } from './types';

export function CardCourseEditor({course,term,onClose,onSave,busy=false,extra,error,title='编辑卡片模板'}:{course:CourseData;term:Term;onClose:()=>void;onSave:(course:CourseData)=>void;busy?:boolean;extra?:ReactNode;error?:string;title?:string}){
  const [name,setName]=useState(course.course_name),[teacher,setTeacher]=useState(course.teacher||'');
  const [lessons,setLessons]=useState(()=>cardLessons(course,term).map((s,i)=>({...s,key:i})));
  const [dirty,setDirty]=useState(false),[validation,setValidation]=useState('');
  function update(key:number,patch:Partial<ExplicitSession>){setDirty(true);setValidation('');setLessons(old=>old.map(s=>s.key===key?{...s,...patch}:s));}
  function add(){setDirty(true);setLessons(old=>[...old,{key:Math.max(-1,...old.map(s=>s.key))+1,lesson_number:Math.max(0,...old.map(s=>s.lesson_number||0))+1,date:'',week:null,start_time:'',end_time:'',room:'',kind:'lecture'}]);}
  function submit(e:FormEvent){
    e.preventDefault();if(busy)return;
    const numbers=lessons.map(s=>s.lesson_number);
    if(numbers.some(n=>!Number.isInteger(n)||Number(n)<1||Number(n)>200)){setValidation('第几次课只能填写 1—200 的整数。');return;}
    if(new Set(numbers).size!==numbers.length){setValidation('课次不能重复，请检查“第几次课”。');return;}
    const clean=lessons.map(({key,...s})=>s).sort((a,b)=>a.lesson_number!-b.lesson_number!);
    const value=dirty?replaceCardLessons(course,clean,term):course;
    onSave({...value,course_name:name,teacher,academic_year:term.academicYear,semester:term.name});
  }
  const remaining=replaceCardLessons(course,[],term);
  return <Modal title={title} onClose={onClose} busy={busy}><form className="manage-form wide-form card-course-editor" onSubmit={submit}>
    <div className="form-grid"><label>课程名称<input required maxLength={120} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label><label>老师<input value={teacher} disabled={busy} onChange={e=>setTeacher(e.target.value)}/></label></div>
    <div className="mini-heading lesson-list-heading"><strong>上课安排 · {lessons.length} 次课</strong><button type="button" className="secondary-button" disabled={busy||lessons.length>=200} onClick={add}><Plus size={16}/>新增课堂</button></div>
    {!lessons.length&&<p className="muted-note">暂无明确的上课安排，点击右上角“新增课堂”添加。</p>}
    <div className="lesson-editor-list">{[...lessons].sort((a,b)=>(a.lesson_number||201)-(b.lesson_number||201)).map(s=><section className="lesson-editor-card" key={s.key}>
      <div className="mini-heading"><h3>{s.lesson_number?lessonTitle(s.lesson_number):'新增课堂'}</h3><button type="button" className="text-button danger-text" disabled={busy} aria-label={`删除第${s.lesson_number||''}次课`} onClick={()=>{setDirty(true);setLessons(old=>old.filter(item=>item.key!==s.key));}}><Trash2 size={15}/>删除</button></div>
      <div className="lesson-editor-fields">
        <label>第几次课<input type="number" min="1" max="200" step="1" required disabled={busy} value={s.lesson_number??''} onChange={e=>update(s.key,{lesson_number:e.target.value===''?null:Number(e.target.value)})}/></label>
        <label>上课日期<input type="date" required disabled={busy} value={s.date} onChange={e=>update(s.key,{date:e.target.value,week:dateWeek(e.target.value,term)})}/></label>
        <label>上课周次<input type="number" min="1" max="60" step="1" disabled={busy} value={s.week??''} placeholder="未确定可留空" onChange={e=>update(s.key,{week:e.target.value===''?null:Number(e.target.value)})}/></label>
        <label>星期<input readOnly value={s.date?`星期${['一','二','三','四','五','六','日'][(dateWeekday(s.date)||1)-1]}`:''} placeholder="选择日期后自动显示"/></label>
        <label className="lesson-room">地点<input maxLength={120} disabled={busy||s.kind==='practice'} value={s.room||''} placeholder={s.kind==='practice'?'实践活动 · 不在教室授课':'地点待通知'} onChange={e=>update(s.key,{room:e.target.value})}/></label>
        <label>上课开始时间<input type="time" required disabled={busy} value={s.start_time} onChange={e=>update(s.key,{start_time:e.target.value})}/></label>
        <label>上课结束时间<input type="time" required disabled={busy} value={s.end_time} onChange={e=>update(s.key,{end_time:e.target.value})}/></label>
      </div>
    </section>)}</div>
    {(remaining.weekly_rules.length>0||remaining.special_dates.length>0)&&<p className="notice">还有尚未明确日期或时间的原始安排，保存时将继续保留。请对照导入内容核对。</p>}
    <p className="muted-note">星期随日期自动更新；周次可根据校历自动带出，无法确定时可手动填写。每次课单独维护地点和起止时间。</p>
    {extra}{(validation||error)&&<p role="alert" className="feedback">{validation||error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button compact" disabled={busy}>{busy?'正在保存…':'保存并重新检查'}</button></div>
  </form></Modal>;
}
