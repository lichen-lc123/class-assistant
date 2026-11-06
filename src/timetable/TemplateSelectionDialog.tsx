import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Clock3 } from 'lucide-react';
import { api } from '../services/auth';
import { Modal } from '../components/Modal';
import { TemplateUsers } from './TemplateUsers';
import { CourseWeekdays } from './CourseWeekdays';
import { weekdayLabel } from './date';
import { errorMessage, type Course, type Preview, type Template, type Term, type TimetableView } from './types';

export function TemplateSelectionDialog({term,current,onClose,onSaved}:{term:Term;current:TimetableView|null;onClose:()=>void;onSaved:()=>void}) {
  const [templates,setTemplates]=useState<Template[]>([]),[index,setIndex]=useState(0);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [result,setResult]=useState<{templateId:string;preview:Preview}|null>(null);
  const [retry,setRetry]=useState(0),[listRetry,setListRetry]=useState(0),[direction,setDirection]=useState<'next'|'previous'>('next');
  const template=templates[index];
  const preview=template&&result?.templateId===template.id?result.preview:null;

  useEffect(()=>{
    let active=true;
    setLoading(true);setTemplates([]);setIndex(0);setResult(null);setError('');
    api<Template[]>(`/timetable/templates?termId=${term.id}`)
      .then(list=>{if(active)setTemplates(list);})
      .catch(e=>{if(active)setError(errorMessage(e));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[term.id,listRetry]);

  useEffect(()=>{
    let active=true;
    setResult(null);
    if(template){
      setError('');
      api<Preview>('/timetable/selection-preview','POST',{termId:term.id,source:'template',templateId:template.id})
        .then(data=>{if(active)setResult({templateId:template.id,preview:data});})
        .catch(e=>{if(active)setError(errorMessage(e));});
    }
    return()=>{active=false;};
  },[term.id,template?.id,retry]);

  function navigate(step:number){
    const next=index+step;
    if(saving||next<0||next>=templates.length)return;
    setDirection(step>0?'next':'previous');setError('');setIndex(next);
  }
  async function save(){
    if(!template||!preview||preview.importBlocked||saving)return;
    setSaving(true);setError('');
    try{
      await api(`/timetable/${term.id}`,'POST',{source:'template',templateId:template.id,selectionVersion:preview.selectionVersion,revision:current?.timetable?.revision||0,acceptWarnings:true});
      onSaved();onClose();
    }catch(e){setError(errorMessage(e));setResult(null);}
    finally{setSaving(false);}
  }

  return <Modal title="使用课表模板" onClose={onClose} busy={saving}>
    <div className="manage-form selection-dialog template-carousel">
      <p className="muted-note">{term.academicYear} · {term.name}</p>
      {loading?<p className="empty-state" role="status">正在加载模板…</p>:template?<>
        <div className="template-carousel-navigation">
          <button type="button" className="icon-button template-arrow" aria-label="上一个模板" title="上一个模板" disabled={saving||index===0} onClick={()=>navigate(-1)}><ChevronLeft size={23}/></button>
          <div className="template-carousel-heading" aria-live="polite"><span>模板 {index+1} / {templates.length}</span><h3>{preview?.templateName||template.name}</h3><TemplateUsers names={template.subscriberNames}/><p>{preview?.courses.length??template.courseIds.length} 门课程</p></div>
          <button type="button" className="icon-button template-arrow" aria-label="下一个模板" title="下一个模板" disabled={saving||index===templates.length-1} onClick={()=>navigate(1)}><ChevronRight size={23}/></button>
        </div>
        <div className={`template-carousel-slide template-slide-${direction}`} key={template.id}>
          {preview?<>
            <div className="template-course-heading"><strong>全部课程</strong><span>共 {preview.courses.length} 门</span></div>
            <div className="template-preview-courses">{preview.courses.map((course,i)=><TemplateCourse key={course.id} course={course} index={i}/>)}</div>
          </>:error?null:<p className="empty-state" role="status">正在加载该模板的全部课程…</p>}
        </div>
      </>:!error?<p className="empty-state">管理员尚未发布本学期模板。</p>:null}
      {preview?.importError&&<p role="alert" className="feedback">{preview.importError}</p>}
      {error&&<><p role="alert" className="feedback">{error}</p><button type="button" className="secondary-button" disabled={saving} onClick={()=>{setError('');if(template)setRetry(v=>v+1);else setListRetry(v=>v+1);}}>重新加载模板</button></>}
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>取消</button><button type="button" className="primary-button compact" disabled={saving||!template||!preview||preview.importBlocked} onClick={()=>void save()}>{saving?'正在保存…':'使用此模板'}</button></div>
    </div>
  </Modal>;
}

function TemplateCourse({course,index}:{course:Course;index:number}){
  const first=course.sessions[0];
  return <article className="template-preview-course">
    <div className="template-course-title"><span>{index+1}</span><h4>{course.course_name}</h4></div><CourseWeekdays sessions={course.sessions}/>
    {first?<><p className="template-course-time"><Clock3 size={15}/><span>{first.date} · {weekdayLabel(first.date)} · {first.start_time}—{first.end_time}<small>第 {first.lesson_number??1} 次课</small></span></p><p className="template-course-room"><MapPin size={15}/><strong>{first.kind==='practice'?'实践活动，不在教室授课':first.room||'教室待通知'}</strong></p></>:<><p className="pending-status">上课时间待安排</p><p className="template-course-room"><MapPin size={15}/><strong>{course.room||'教室待通知'}</strong></p></>}
    <p className="template-course-meta">{course.teacher||'老师待确认'} · {course.sessions.length} 次已确定安排</p>
    {course.sessions.length>0&&<details className="template-lesson-details"><summary>查看全部 {course.sessions.length} 次上课安排</summary><ol>{course.sessions.map((session,i)=><li key={`${session.start}-${i}`}><strong>第 {session.lesson_number??i+1} 次课</strong><time dateTime={session.start}>{session.date} · {weekdayLabel(session.date)} · {session.start_time}—{session.end_time}</time><span>{session.kind==='practice'?'实践活动，不在教室授课':session.room||'教室待通知'}</span></li>)}</ol></details>}
  </article>;
}
