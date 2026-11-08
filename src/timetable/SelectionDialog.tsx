import { SelectionMonthPreview } from './SelectionMonthPreview';
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../services/auth';
import { Modal } from '../components/Modal';
import { CourseCardTimes } from './CourseCardTimes';
import { TemplateSelectionDialog } from './TemplateSelectionDialog';
import { type Course, type Preview, type Term, type TimetableView, errorMessage } from './types';

type SelectionProps={term:Term;source:'template'|'cards';current:TimetableView|null;onClose:()=>void;onSaved:()=>void};
export function SelectionDialog(props:SelectionProps){
  return props.source==='template'?<TemplateSelectionDialog term={props.term} current={props.current} onClose={props.onClose} onSaved={props.onSaved}/>:<CardSelectionDialog {...props}/>;
}
function CardSelectionDialog({term,current,onClose,onSaved}:Omit<SelectionProps,'source'>){
  const [cards,setCards]=useState<Course[]>([]),[selected,setSelected]=useState<string[]>([]);
  const [query,setQuery]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[accepted,setAccepted]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [progress,setProgress]=useState('');
  const [checkingSelection,setCheckingSelection]=useState(false);
  const [monthPreview,setMonthPreview]=useState<{preview:Preview;current:TimetableView}|null>(null);
  const previewRequest=useRef(0);
  const inFlight=useRef(false),feedback=useRef<HTMLParagraphElement>(null),confirmation=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(error)feedback.current?.scrollIntoView({block:'nearest'});},[error]);
  useEffect(()=>{let active=true;setBusy(true);api<Course[]>(`/timetable/cards?termId=${term.id}`).then(c=>{if(active)setCards(c);}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[term.id]);
  const available=new Map(cards.map(c=>[c.id,c]));
  for(const c of current?.courses||[])if(c.publicCourseId&&!available.has(c.publicCourseId))available.set(c.publicCourseId,{...c,id:c.publicCourseId});
  function toggle(id:string,add:boolean){if(busy||inFlight.current)return;previewRequest.current++;setCheckingSelection(false);setSelected(v=>add?[...new Set([...v,id])]:v.filter(x=>x!==id));setPreview(null);setAccepted(true);setError('');}
  useEffect(()=>{
    let active=true;
    if(!selected.length)return;
    const timer=window.setTimeout(()=>{
      if(inFlight.current)return;
      const token=++previewRequest.current;setCheckingSelection(true);
      api<Preview>('/timetable/selection-preview','POST',{termId:term.id,source:'cards',courseIds:selected}).then(p=>{
        if(active&&token===previewRequest.current){setPreview(p);setAccepted(true);setError(p.importBlocked?p.importError||'课程时间重复，请调整选择。':'');}
      }).catch(e=>{if(active&&token===previewRequest.current)setError(errorMessage(e));}).finally(()=>{if(active&&token===previewRequest.current)setCheckingSelection(false);});
    },200);
    return()=>{active=false;clearTimeout(timer);};
  },[selected,term.id]);
  const needsReview=(p:Preview)=>Boolean(p.warnings.length||p.conflicts.length||p.courses.some(c=>c.warnings.length));
  async function inspect(){
    if(busy||inFlight.current)return;
    if(!selected.length){setError('请先将需要的课程加入右侧“本次新增课程”。');return;}
    previewRequest.current++;setCheckingSelection(false);inFlight.current=true;setBusy(true);setProgress('正在检查课程…');setError('');setAccepted(true);
    try{const [table,p]=await Promise.all([api<TimetableView>(`/timetable/${term.id}`),api<Preview>('/timetable/selection-preview','POST',{termId:term.id,source:'cards',courseIds:selected})]);setPreview(p);setMonthPreview({preview:p,current:table});if(p.importBlocked)setError(p.importError||'课程时间重复，请调整选择后重试。');}
    catch(e){setPreview(null);setError(errorMessage(e));}
    finally{inFlight.current=false;setBusy(false);setProgress('');}
  }
  async function save(){
    if(busy||inFlight.current)return;
    if(!selected.length){setError('请先将需要的课程加入右侧“本次新增课程”。');return;}
    previewRequest.current++;setCheckingSelection(false);inFlight.current=true;setBusy(true);setProgress('正在检查课程…');setError('');
    try{
      // Always recheck the current cards before writing: administrators can
      // update their schedule while this dialog remains open.
      const p=await api<Preview>('/timetable/selection-preview','POST',{termId:term.id,source:'cards',courseIds:selected});setPreview(p);
      if(p.importBlocked){setError(p.importError||'课程时间重复，请调整选择后重试。');return;}
      const reviewed=accepted;
      if(needsReview(p)&&!reviewed){setError('请确认已核对所选课程后再添加。');requestAnimationFrame(()=>confirmation.current?.focus());return;}
      setProgress('正在添加课程…');
      await api(`/timetable/${term.id}`,'POST',{source:'cards',courseIds:selected,revision:current?.timetable?.revision||0,acceptWarnings:reviewed});onSaved();onClose();
    }catch(e){setError(errorMessage(e));}
    finally{inFlight.current=false;setBusy(false);setProgress('');}
  }
  const matching=cards.filter(c=>`${c.course_name} ${c.teacher||''}`.toLowerCase().includes(query.toLowerCase()));
  const visible=matching.filter(c=>!selected.includes(c.id));
  return <><Modal title="自由组合本学期课程" onClose={onClose} busy={busy}><div className="manage-form selection-dialog"><p className="muted-note">{term.academicYear} · {term.name} · 卡片模板由管理员自动生成或手动添加</p>
    <>
      <div className="cards-search"><label className="search-box"><Search size={17}/><input aria-label="搜索课程卡片" placeholder="搜索课程名称或老师" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
      <div className="card-builder"><section><h3>管理员卡片模板</h3><div className="available-cards">{visible.map(c=><article draggable={!busy} className="selectable-card clickable-course-card" role="button" tabIndex={busy?-1:0} aria-disabled={busy} aria-label={`添加${c.course_name}到本次新增课程`} key={c.id} onClick={()=>toggle(c.id,true)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle(c.id,true);}}} onDragStart={e=>{if(busy){e.preventDefault();return;}e.dataTransfer.setData('text/plain',c.id);e.dataTransfer.effectAllowed='copy';}}><h4>{c.course_name}</h4><CourseCardTimes sessions={c.sessions}/><p>{c.teacher||'老师待确认'}</p><small>{c.sessions.length?`${c.sessions[0].date} 起，共 ${c.sessions.length} 次安排`:'时间待安排'}</small></article>)}</div>{!visible.length&&<p className="empty-state">{busy?'正在加载…':matching.length?'匹配的课程已全部加入右侧。':'暂无匹配卡片。只有管理员生成并发布的卡片会显示在这里。'}</p>}</section>
      <section className="my-course-drop" onDragOver={e=>{if(busy)return;e.preventDefault();e.dataTransfer.dropEffect='copy';}} onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain');if(cards.some(c=>c.id===id))toggle(id,true);}}><h3>本次新增课程 <span>{selected.length}</span></h3><p className="muted-note">点击左侧卡片或将其拖入这里，再点击“确认添加课程”。系统会自动检查时间，添加后保留已有课表。</p>{selected.map(id=>{const c=available.get(id);return c?<article className="chosen-course" key={id}><div><strong>{c.course_name}</strong><CourseCardTimes sessions={c.sessions}/><p>{c.teacher||'待确认'}</p></div><button type="button" className="icon-button" aria-label={`移除${c.course_name}`} disabled={busy} onClick={()=>toggle(id,false)}><X size={17}/></button></article>:null;})}</section></div>
    </>
    <button type="button" className="secondary-button" disabled={busy||!selected.length} onClick={()=>void inspect()}>{busy?'正在检查…':'检查并预览课程安排'}</button>
    {checkingSelection&&<p className="muted-note" role="status">正在检查所选课程与已有课表的时间…</p>}
    {preview&&<>{needsReview(preview)&&!preview.importBlocked&&<label className="checkbox-line"><input ref={confirmation} type="checkbox" disabled={busy} checked={accepted} onChange={e=>{setAccepted(e.target.checked);setError('');}}/><span>默认已核对，可直接添加；时间重复的课程不能导入。</span></label>}</>}
    {error&&<p ref={feedback} role="alert" className="feedback">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="primary-button compact" disabled={busy} onClick={()=>void save()}>{progress||'确认添加课程'}</button></div>
  </div></Modal>{monthPreview&&<SelectionMonthPreview term={term} preview={monthPreview.preview} current={monthPreview.current} onClose={()=>setMonthPreview(null)}/>}</>;
}
