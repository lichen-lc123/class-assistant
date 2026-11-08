import {CourseSchedule} from '../timetable/CourseSchedule';
import {useEffect,useState} from 'react';
import {Modal} from '../components/Modal';
import {api} from '../services/auth';
import {errorMessage,type Course,type Term} from '../timetable/types';
import {CourseHomeworkSummary} from './CourseHomeworkSummary';
import {HomeworkDetailDialog} from './HomeworkDetailDialog';
import type {Homework} from './types';

export const openCourseHomework=(entryId:string)=>window.dispatchEvent(new CustomEvent('open-course-homework',{detail:entryId}));
export function CourseHomeworkHost(){
  const [entryId,setEntryId]=useState<string|null>(null);
  useEffect(()=>{const open=(event:Event)=>{const id=(event as CustomEvent).detail;if(typeof id==='string')setEntryId(id);};window.addEventListener('open-course-homework',open);return()=>window.removeEventListener('open-course-homework',open);},[]);
  return entryId?<CourseHomeworkDialog key={entryId} entryId={entryId} onClose={()=>setEntryId(null)}/>:null;
}
function CourseHomeworkDialog({entryId,onClose}:{entryId:string;onClose:()=>void}){
  const [detailId,setDetailId]=useState<string|null>(null);
  const [data,setData]=useState<{course:Course;records:Homework[];term:Term}|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true,request=0;const refresh=()=>{const token=++request;void api<{course:Course;records:Homework[];term:Term}>('/homework/course/'+entryId).then(r=>{if(active&&token===request){setData(r);setError('');}}).catch(e=>{if(active&&token===request)setError(errorMessage(e));});};refresh();window.addEventListener('homework-updated',refresh);return()=>{active=false;window.removeEventListener('homework-updated',refresh);};},[entryId]);
  const pending=data?.records.filter(r=>r.kind==='assignment'&&!r.completed)||[];
  const completed=data?.records.filter(r=>r.kind==='assignment'&&r.completed)||[];
  const references=data?.records.filter(r=>r.kind==='reference')||[];
  const facts=data?[
    ['学分',data.course.credits==null?'':String(data.course.credits)],
    ['开课学院',data.course.college],
    ['修读类型',data.course.required_or_elective],
    ['课程性质',data.course.course_category],
  ].filter(([,value])=>Boolean(value)):[];
  return <><Modal title={data?.course.course_name||'课程详情'} onClose={onClose}><div className="manage-form course-homework-dialog">
    {data&&<><p className="course-detail-teacher">{data.course.teacher||'老师待确认'}</p>
      {facts.length>0&&<dl className="course-detail-facts">{facts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      <CourseHomeworkSummary title="待做作业" records={pending} onOpen={setDetailId} emptyText="暂无待做作业"/>
      <CourseHomeworkSummary title="已完成作业" records={completed} onOpen={setDetailId} emptyText="暂无已完成作业"/>
      <section className="course-all-dates"><h3>全部上课日期</h3><CourseSchedule course={data.course}/></section>
      <CourseHomeworkSummary title="考核说明" records={references} onOpen={setDetailId}/>
    </>}
    {error&&<p className="feedback" role="alert">{error}</p>}{!data&&!error&&<p role="status">正在读取课程详情…</p>}
  </div></Modal>{detailId&&<HomeworkDetailDialog key={detailId} recordId={detailId} onClose={()=>setDetailId(null)} closeLabel="返回课程详情"/>}</>;
}
