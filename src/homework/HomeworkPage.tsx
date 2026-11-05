import {useEffect,useRef,useState} from 'react';
import {Plus,Upload,RefreshCw,CheckCircle2} from 'lucide-react';
import {api} from '../services/auth';
import {Modal} from '../components/Modal';
import {errorMessage,type Term,type TermList} from '../timetable/types';
import {HomeworkCard} from './HomeworkCard';
import {HomeworkEditor} from './HomeworkEditor';
import {HomeworkImport} from './HomeworkImport';
import {HomeworkPlan} from './HomeworkPlan';
import {PersonalHomeworkEditor} from './PersonalHomeworkEditor';
import {emptyHomework,homeworkChanged,type Homework,type HomeworkTarget} from './types';
export function HomeworkPage({admin=false}:{admin?:boolean}){
  const [terms,setTerms]=useState<Term[]>([]),[termId,setTermId]=useState(''),[ready,setReady]=useState(false),[records,setRecords]=useState<Homework[]>([]),[classes,setClasses]=useState<HomeworkTarget[]>([]),[filter,setFilter]=useState(admin?'all':'pending'),[query,setQuery]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[personalEdit,setPersonalEdit]=useState<Homework|'new'|null>(null),[plan,setPlan]=useState<Homework|null>(null),[editing,setEditing]=useState<Homework|null>(null),[deleting,setDeleting]=useState<Homework|null>(null),[importing,setImporting]=useState(false);
  const request=useRef(0),term=terms.find(t=>t.id===termId);
  useEffect(()=>{let active=true;api<TermList>('/timetable/terms').then(r=>{if(active){setTerms(r.terms);setTermId(r.currentTermIds[0]||r.terms[0]?.id||'');setReady(true);}}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[]);
  async function load(){if(!ready||admin&&!termId)return;const token=++request.current;setBusy(true);setError('');try{const [data,options]=await Promise.all([api<{records:Homework[]}>(`${admin?'/admin':''}/homework${termId?'?termId='+encodeURIComponent(termId):''}`),admin?api<HomeworkTarget[]>('/admin/homework/classes?termId='+encodeURIComponent(termId)):Promise.resolve([])]);if(request.current===token){setRecords(data.records);setClasses(options);}}catch(e){if(request.current===token)setError(errorMessage(e));}finally{if(request.current===token)setBusy(false);}}
  useEffect(()=>{setRecords([]);setClasses([]);void load();const refresh=()=>void load();window.addEventListener('focus',refresh);window.addEventListener('timetable-updated',refresh);window.addEventListener('homework-updated',refresh);return()=>{request.current++;window.removeEventListener('focus',refresh);window.removeEventListener('timetable-updated',refresh);window.removeEventListener('homework-updated',refresh);};},[ready,termId,admin]);
  function saved(message:string){setNotice(message);homeworkChanged();}
  async function save(r:Homework){await api(r.id?'/admin/homework/records/'+r.id:'/admin/homework/records',r.id?'PUT':'POST',{termId,record:r,revision:r.revision});setEditing(null);saved('已保存。已发布的内容会按上课班展示给同学。');}
  async function complete(r:Homework){setBusy(true);setError('');try{await api(`/homework/records/${r.id}/completion`,'POST',{completed:!r.completed,revision:r.revision});saved(r.completed?'已恢复为待完成。':'已完成，已移出待做列表，当前版本不再列入后续作业提醒。');}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  const shown=records.filter(r=>`${r.course_name} ${r.teacher} ${r.title} ${r.content}`.toLowerCase().includes(query.toLowerCase())).filter(r=>{
    if(filter==='reference')return r.kind==='reference';
    if(admin)return filter!=='draft'||!r.published;
    if(r.kind!=='assignment')return false;
    if(filter==='done')return r.completed;
    if(filter==='overdue')return r.overdue;
    return filter==='all'||!r.completed;
  });
  const filters=admin?[['all','全部'],['draft','草稿'],['reference','考核说明']]:[['pending','待完成'],['overdue','已逾期'],['done','已完成'],['reference','考核说明'],['all','全部作业']];
  return <div className="homework-page"><section className="workspace-card homework-toolbar"><div className="section-heading"><div><h2>{admin?'课程作业与考核管理':'我的作业'}</h2><p>{admin?'上传、核对并发布各上课班的作业；未确认班级的内容保留草稿。':'按个人优先级、计划完成时间排序；未调整时按作业原截止时间排序。'}</p></div><div className="toolbar-actions">{!admin&&<button className="primary-button compact" disabled={!ready||!terms.length||busy} onClick={()=>setPersonalEdit('new')}><Plus size={16}/>新增个人作业</button>}{admin&&<><button className="secondary-button" disabled={!term||busy} onClick={()=>setEditing(emptyHomework())}><Plus size={16}/>新增</button><button className="primary-button compact" disabled={!term||busy} onClick={()=>setImporting(true)}><Upload size={16}/>导入 Excel</button></>}<button className="icon-button" aria-label="刷新作业" disabled={busy||!ready} onClick={()=>void load()}><RefreshCw size={17}/></button></div></div>
    <div className="homework-controls"><label>学期<select value={termId} onChange={e=>{setTermId(e.target.value);setNotice('');}}>{!admin&&<option value="">全部学期</option>}{!terms.length&&<option value="">暂无学期</option>}{terms.map(t=><option key={t.id} value={t.id}>{t.academicYear} · {t.name}</option>)}</select></label><label>搜索<input type="search" placeholder="课程、老师或作业关键词" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>{!admin&&<p className="muted-note">点击作业卡片上的“完成并停止提醒”，完成后可在“已完成”中查看或撤销。</p>}<div className="segmented homework-filters">{filters.map(([key,label])=><button key={key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}</button>)}</div></section>
    {notice&&<p className="notice" role="status">{notice}</p>}{error&&<p className="feedback" role="alert">{error}</p>}{busy&&<p role="status" className="muted-note">正在更新…</p>}
    <div className="homework-grid">{shown.map(r=><HomeworkCard key={r.id} record={r}>{admin?<><button className="secondary-button" onClick={()=>setEditing(r)}>编辑 / 发布</button><button className="text-button danger-text" onClick={()=>setDeleting(r)}>删除</button></>:r.kind==='assignment'?<>{r.canEdit&&<><button className="secondary-button" disabled={busy} onClick={()=>setPersonalEdit(r)}>编辑</button><button className="text-button danger-text" disabled={busy} onClick={()=>setDeleting(r)}>删除</button></>}<button className="secondary-button" disabled={busy} onClick={()=>setPlan(r)}>我的安排</button><button className={r.completed?'secondary-button':'primary-button compact'} disabled={busy} onClick={()=>void complete(r)}><CheckCircle2 size={17}/>{r.completed?'撤销完成':'完成并停止提醒'}</button></>:undefined}</HomeworkCard>)}</div>
    {!shown.length&&!busy&&!error&&<section className="workspace-card empty-state">{admin?'暂无符合条件的记录。可选择学期后新增或导入 Excel。':'暂无符合条件的作业。可以新增个人作业；课程作业按你课表中已选上课班展示，若有遗漏请核对班号。'}</section>}
    {personalEdit&&<PersonalHomeworkEditor record={personalEdit==='new'?null:personalEdit} terms={terms} initialTermId={termId} onClose={()=>setPersonalEdit(null)} onSaved={id=>{setFilter('pending');setQuery('');if(termId&&termId!==id)setTermId(id);saved('个人作业已保存，仅自己可见，并参与工作台排序。');}}/>}
    {plan&&<HomeworkPlan record={plan} onClose={()=>setPlan(null)} onSaved={()=>saved('个人安排已更新，工作台会按你的优先级和计划时间排序。')}/>}
    {editing&&term&&<HomeworkEditor record={editing} term={term} classes={classes} onClose={()=>setEditing(null)} onSave={save}/>}{importing&&term&&<HomeworkImport term={term} onClose={()=>setImporting(false)} onSaved={saved}/>}
    {deleting&&<Modal title="删除作业记录" onClose={()=>setDeleting(null)} busy={busy}><div className="manage-form"><p>确定删除“{deleting.title}”吗？{deleting.sourceType==='personal'?'仅删除你自己的个人作业。':'相关同学将不再看到该记录。'}</p>{error&&<p className="feedback" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary-button" disabled={busy} onClick={()=>setDeleting(null)}>取消</button><button className="primary-button compact danger-button" disabled={busy} onClick={async()=>{setBusy(true);try{await api((admin?'/admin/homework/records/':'/homework/personal/')+deleting.id,'DELETE',{revision:deleting.revision,confirm:true});setDeleting(null);saved('记录已删除。');}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}}>确认删除</button></div></div></Modal>}
  </div>;
}
