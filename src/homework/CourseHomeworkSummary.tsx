import {CheckCircle2,ChevronRight,ClipboardList} from 'lucide-react';
import {deadlineLabel,type Homework} from './types';

export function CourseHomeworkSummary({title,records,onOpen,emptyText}:{title:string;records:Homework[];onOpen:(id:string)=>void;emptyText?:string}){
  if(!records.length&&!emptyText)return null;
  return <section className="course-work-summary"><h3>{title}<span>{records.length}</span></h3>{!records.length&&<p className="course-work-empty">{emptyText}</p>}<div className="course-work-thumbnails">{records.map(record=>{
    const thumbnail=record.attachments.find(a=>a.field==='content'&&a.mime?.startsWith('image/')&&a.url);
    return <button type="button" key={record.id} className="course-work-thumbnail" onClick={()=>record.id&&onOpen(record.id)}><span className="course-work-icon">{thumbnail?<img src={thumbnail.url} alt="" loading="lazy"/>:record.completed?<CheckCircle2 size={22}/>:<ClipboardList size={22}/>}</span><span className="course-work-text"><strong>{record.title}</strong>{record.kind==='assignment'&&<small>{record.completed?'已完成':deadlineLabel(record)}</small>}</span>{record.hasUpdates&&<span className="course-work-updated">有更新</span>}<ChevronRight size={16}/></button>;
  })}</div></section>;
}
