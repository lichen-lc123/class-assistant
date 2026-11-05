import { useEffect, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import { api } from '../services/auth';
import { Modal } from '../components/Modal';
import { PreviewIssues } from './ImportDialog';
import { CourseCardTimes } from './CourseCardTimes';
import { TemplateSelectionDialog } from './TemplateSelectionDialog';
import { type Course, type Preview, type Term, type TimetableView, errorMessage } from './types';

type SelectionProps={term:Term;source:'template'|'cards';current:TimetableView|null;onClose:()=>void;onSaved:()=>void};
export function SelectionDialog(props:SelectionProps){
  return props.source==='template'?<TemplateSelectionDialog term={props.term} current={props.current} onClose={props.onClose} onSaved={props.onSaved}/>:<CardSelectionDialog {...props}/>;
}
function CardSelectionDialog({term,current,onClose,onSaved}:Omit<SelectionProps,'source'>){
  const [cards,setCards]=useState<Course[]>([]),[selected,setSelected]=useState<string[]>([]);
  const [query,setQuery]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[accepted,setAccepted]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;setBusy(true);api<Course[]>(`/timetable/cards?termId=${term.id}`).then(c=>{if(active)setCards(c);}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[term.id]);
  const available=new Map(cards.map(c=>[c.id,c]));
  for(const c of current?.courses||[])if(c.publicCourseId&&!available.has(c.publicCourseId))available.set(c.publicCourseId,{...c,id:c.publicCourseId});
  function toggle(id:string,add:boolean){if(busy)return;setSelected(v=>add?[...new Set([...v,id])]:v.filter(x=>x!==id));setPreview(null);setAccepted(false);}
  async function inspect(){setBusy(true);setError('');setAccepted(false);try{setPreview(await api<Preview>('/timetable/selection-preview','POST',{termId:term.id,source:'cards',courseIds:selected}));}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  async function save(){if(!preview||preview.importBlocked||!accepted||busy)return;setBusy(true);setError('');try{await api(`/timetable/${term.id}`,'POST',{source:'cards',courseIds:selected,revision:current?.timetable?.revision||0,acceptWarnings:accepted});onSaved();onClose();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  const visible=cards.filter(c=>`${c.course_name} ${c.teacher||''} ${c.course_code||''} ${c.teaching_class_code||''}`.toLowerCase().includes(query.toLowerCase()));
  return <Modal title="自由组合本学期课程" onClose={onClose} busy={busy}><div className="manage-form selection-dialog"><p className="muted-note">{term.academicYear} · {term.name} · 卡片模板由管理员自动生成或手动添加</p>
    <>
      <div className="cards-search"><label className="search-box"><Search size={17}/><input aria-label="搜索课程卡片" placeholder="课程、老师、课程编号或上课班编号" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
      <div className="card-builder"><section><h3>管理员卡片模板</h3><div className="available-cards">{visible.map(c=><article draggable className={'selectable-card '+(selected.includes(c.id)?'is-selected':'')} key={c.id} onDragStart={e=>{e.dataTransfer.setData('text/plain',c.id);e.dataTransfer.effectAllowed='copy';}}><h4>{c.course_name}</h4><CourseCardTimes sessions={c.sessions}/><p>{c.teacher||'老师待确认'} · {c.teaching_class_code||'班号待确认'}</p><small>{c.sessions.length?`${c.sessions[0].date} 起，共 ${c.sessions.length} 次安排`:'时间待安排'}</small><button type="button" className="text-button" disabled={selected.includes(c.id)} onClick={()=>toggle(c.id,true)}>{selected.includes(c.id)?<><Check size={14}/>已加入</>:<><Plus size={14}/>加入我的课程</>}</button></article>)}</div>{!visible.length&&<p className="empty-state">{busy?'正在加载…':'暂无匹配卡片。只有管理员生成并发布的卡片会显示在这里。'}</p>}</section>
      <section className="my-course-drop" onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';}} onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain');if(cards.some(c=>c.id===id))toggle(id,true);}}><h3>本次新增课程 <span>{selected.length}</span></h3><p className="muted-note">拖入卡片或点击加入，保存后追加到已有课表。</p>{selected.map(id=>{const c=available.get(id);return c?<article className="chosen-course" key={id}><div><strong>{c.course_name}</strong><CourseCardTimes sessions={c.sessions}/><p>{c.teacher||'待确认'} · {c.teaching_class_code||'班号待确认'}</p></div><button type="button" className="icon-button" aria-label={`移除${c.course_name}`} onClick={()=>toggle(id,false)}><X size={17}/></button></article>:null;})}</section></div>
    </>
    <button type="button" className="secondary-button" disabled={busy||!selected.length} onClick={()=>void inspect()}>{busy?'正在检查…':'检查并预览课程安排'}</button>
    {preview&&<><div className="notice">将选择 {preview.courses.length} 门课程。</div><PreviewIssues preview={preview}/><label className="checkbox-line"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>我已核对新增课程及缺失信息；时间重复的课程不能导入。</span></label></>}
    {error&&<p role="alert" className="feedback">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="primary-button compact" disabled={busy||!preview||preview.importBlocked||!accepted} onClick={()=>void save()}>确认添加课程</button></div>
  </div></Modal>;
}
