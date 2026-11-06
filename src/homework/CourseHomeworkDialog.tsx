import {useEffect,useState} from 'react';
import {Modal} from '../components/Modal';
import {api} from '../services/auth';
import {errorMessage,type Course,type Term} from '../timetable/types';
import {HomeworkCard} from './HomeworkCard';
import {homeworkChanged,type Homework} from './types';

export const openCourseHomework=(entryId:string)=>window.dispatchEvent(new CustomEvent('open-course-homework',{detail:entryId}));
export function CourseHomeworkHost(){
  const [entryId,setEntryId]=useState<string|null>(null);
  useEffect(()=>{const open=(event:Event)=>{const id=(event as CustomEvent).detail;if(typeof id==='string')setEntryId(id);};window.addEventListener('open-course-homework',open);return()=>window.removeEventListener('open-course-homework',open);},[]);
  return entryId?<CourseHomeworkDialog key={entryId} entryId={entryId} onClose={()=>setEntryId(null)}/>:null;
}
function CourseHomeworkDialog({entryId,onClose}:{entryId:string;onClose:()=>void}){
  const [data,setData]=useState<{course:Course;records:Homework[];term:Term}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[filter,setFilter]=useState('pending');
  useEffect(()=>{let active=true,request=0;const refresh=()=>{const token=++request;void api<{course:Course;records:Homework[];term:Term}>('/homework/course/'+entryId).then(r=>{if(active&&token===request){setData(r);setError('');}}).catch(e=>{if(active&&token===request)setError(errorMessage(e));});};refresh();window.addEventListener('homework-updated',refresh);return()=>{active=false;window.removeEventListener('homework-updated',refresh);};},[entryId]);
  async function complete(r:Homework){if(busy)return;setBusy(true);setError('');try{const updated=await api<Homework>(`/homework/records/${r.id}/completion`,'POST',{completed:!r.completed,revision:r.revision});setData(old=>old?{...old,records:old.records.map(item=>item.id===r.id?updated:item)}:old);homeworkChanged();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  const visible=data?.records.filter(r=>filter==='reference'?r.kind==='reference':r.kind==='assignment'&&(filter==='done'?r.completed:!r.completed))||[];
  return <Modal title={data?.course.course_name||'课程作业'} onClose={onClose} busy={busy}><div className="manage-form course-homework-dialog"><p className="course-detail-teacher">{data?.course.teacher||'老师待确认'}</p><div className="segmented">{[['pending','待完成'],['done','已完成'],['reference','考核说明']].map(([key,label])=><button type="button" key={key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}<span className="filter-count">{data?.records.filter(r=>key==='reference'?r.kind==='reference':r.kind==='assignment'&&(key==='done'?r.completed:!r.completed)).length||0}</span></button>)}</div>{error&&<p className="feedback" role="alert">{error}</p>}{!data&&!error&&<p role="status">正在读取课程作业…</p>}{visible.map(r=><HomeworkCard key={r.id} record={r} expandDetails>{r.kind==='assignment'&&<button type="button" disabled={busy} className="primary-button compact" onClick={()=>void complete(r)}>{r.completed?'恢复未完成':'完成'}</button>}</HomeworkCard>)}{data&&!visible.length&&<p className="empty-state">{filter==='done'?'暂无已完成作业':filter==='reference'?'暂无考核说明':'这门课程暂无待完成作业'}</p>}</div></Modal>;
}
