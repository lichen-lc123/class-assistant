import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Settings2, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../services/auth';
import { Modal } from '../components/Modal';
import { AcademicCalendar } from './AcademicCalendar';
import { TemplateUsers } from './TemplateUsers';
import { TermEditor } from './TermEditor';
import { CardCourseEditor } from './CardCourseEditor';
import { CourseCardTimes } from './CourseCardTimes';
import { ImportDialog, PreviewIssues } from './ImportDialog';
import { emptyCourse, errorMessage, type Course, type CourseData, type Term, type TermList, type Template, type Preview } from './types';

export function AdminTimetable({initialTab='templates'}:{initialTab?:'templates'|'terms'}){
  const [terms,setTerms]=useState<Term[]>([]),[termId,setTermId]=useState(''),[tab,setTab]=useState<string>(initialTab);
  const [courses,setCourses]=useState<Course[]>([]),[templates,setTemplates]=useState<Template[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [importSource,setImportSource]=useState<'ai'|null>(null),[termEdit,setTermEdit]=useState<Term|'new'|null>(null),[courseEdit,setCourseEdit]=useState<Course|'new'|null>(null),[templateEdit,setTemplateEdit]=useState<Template|'new'|null>(null);
  const [templateDelete,setTemplateDelete]=useState<Template|null>(null);
  const [published,setPublished]=useState(true),[editError,setEditError]=useState(''),[query,setQuery]=useState('');
  const term=terms.find(t=>t.id===termId);
  const contentRequest=useRef(0);
  async function loadTerms(select?:string){try{const r=await api<TermList>('/timetable/terms');setTerms(r.terms);setTermId(old=>select||old||(r.currentTermIds.length===1?r.currentTermIds[0]:r.terms[0]?.id||''));}catch(e){setError(errorMessage(e));}}
  async function loadContents(){if(!termId)return;const token=++contentRequest.current;setBusy(true);setError('');try{const [c,t]=await Promise.all([api<Course[]>(`/admin/timetable/courses?termId=${termId}`),api<Template[]>(`/admin/timetable/templates?termId=${termId}`)]);if(token===contentRequest.current){setCourses(c);setTemplates(t);}}catch(e){if(token===contentRequest.current)setError(errorMessage(e));}finally{if(token===contentRequest.current)setBusy(false);}}
  useEffect(()=>{void loadTerms();},[]);
  useEffect(()=>{void loadContents();},[termId]);
  function saved(message:string){setNotice(message);void loadContents();window.dispatchEvent(new Event('timetable-updated'));}
  async function saveCourse(c:CourseData){if(!courseEdit||!term)return;setBusy(true);setEditError('');try{
    if(courseEdit==='new')await api('/admin/timetable/courses','POST',{termId:term.id,source:'manual',courses:[c],generateCards:true,published,acceptWarnings:true});
    else await api(`/admin/timetable/courses/${courseEdit.id}`,'PUT',{course:c,revision:courseEdit.revision,cardEnabled:true,published,acceptWarnings:true});
    const creating=courseEdit==='new';setCourseEdit(null);saved(creating?'卡片模板已添加，可由学生直接选用，也可加入课表模板。':courseEdit.origin==='manual'?'手动卡片已更新，直接选用该卡片的用户同步更新；模板内的课程安排保留。':'卡片模板已更新，引用它的模板与用户同步更新；个人调整继续优先。');
  }catch(e){setEditError(errorMessage(e));}finally{setBusy(false);}}
  return <div className="timetable-admin"><div className="module-top"><div className="segmented">{[['templates','课表模板'],['terms','学期与作息']].map(([key,label])=><button type="button" className={tab===key?'active':''} key={key} onClick={()=>setTab(key)}>{label}</button>)}</div><button className="secondary-button" onClick={()=>setTermEdit('new')}><Plus size={15}/>建立学期</button></div>
    <div className="term-selector"><label>当前管理学期<select value={termId} onChange={e=>{setTermId(e.target.value);setNotice('');}}><option value="">请选择学期</option>{terms.map(t=><option value={t.id} key={t.id}>{t.academicYear} · {t.name}</option>)}</select></label>{term&&<button className="text-button" onClick={()=>setTermEdit(term)}><Settings2 size={15}/>编辑学期配置</button>}</div>
    {notice&&<p className="notice" role="status">{notice}</p>}{error&&<p role="alert" className="feedback">{error}</p>}
    {!term&&<section className="workspace-card setup-empty"><h2>先建立一个学期</h2><p>每个学期单独管理课表。准确排课需要教学周起点和节次起止时间，暂缺时也可以先保存课程。</p><button className="primary-button compact" onClick={()=>setTermEdit('new')}>建立学期</button></section>}
    {term&&tab==='templates'&&<><section className="workspace-card admin-course-panel"><div className="section-heading"><div><h2>课表模板</h2><p>与个人课表使用相同的 AI 内容导入流程。同一学年可保存多份模板，按学期分别管理，课程名称、上课时间和老师一致时共用课程卡片。</p></div><div className="toolbar-actions"><button className="primary-button compact" disabled={busy} onClick={()=>setImportSource('ai')}><Sparkles size={16}/>AI 内容导入</button></div></div><div className="admin-course-grid">{templates.map(t=><article className="course-tile" key={t.id}><span className="role-badge">{t.published?'已发布':'未发布'}</span><h3>{t.name}</h3><TemplateUsers names={t.subscriberNames}/><p>{t.courseIds.length} 门课程 · 第 {t.revision} 版</p><div className="template-tile-actions"><button type="button" className="secondary-button" disabled={busy} onClick={()=>setTemplateEdit(t)}>编辑模板</button><button type="button" className="text-button danger-text" disabled={busy} onClick={()=>setTemplateDelete(t)}><Trash2 size={15}/>删除模板</button></div></article>)}</div>{!templates.length&&<p className="empty-state">暂无模板。选择“AI 内容导入”，为一位同学的课表命名保存；同一学年可继续添加多份模板。</p>}</section>
      <details open className="workspace-card admin-course-panel template-card-library"><summary>卡片模板（{courses.filter(c=>c.cardEnabled).length} 张）</summary><div className="section-heading card-library-heading"><div><h2>卡片模板</h2><p>导入课表模板后自动生成，也可单独手动添加；名称、时间和老师一致的课程只保留一张。模板生成的卡片修改后联动模板和用户；手动卡片修改后联动直接选用它的用户。</p></div><button type="button" className="primary-button compact" disabled={busy} onClick={()=>{setCourseEdit('new');setPublished(true);setEditError('');}}><Plus size={16}/>手动添加卡片</button></div><input className="standalone-search" aria-label="搜索课程卡片" placeholder="搜索课程或老师" value={query} onChange={e=>setQuery(e.target.value)}/><div className="admin-course-grid">{courses.filter(c=>c.cardEnabled&&`${c.course_name} ${c.teacher}`.toLowerCase().includes(query.toLowerCase())).map(c=><article className="course-tile" key={c.id}><span className="role-badge">{c.published?'已发布':'已下架'}</span><span className="subtle-text card-origin">{c.origin==='manual'?'手动新增':'模板生成'}</span><h3>{c.course_name}</h3><CourseCardTimes sessions={c.sessions}/><p>{c.teacher||'老师待确认'}</p><p>{c.sessions.length} 次已确定安排 · {c.warnings.length?'需核对':'安排已明确'}</p><button className="secondary-button" onClick={()=>{setCourseEdit(c);setPublished(Boolean(c.published));setEditError('');}}>编辑上课安排</button></article>)}</div>{!courses.some(c=>c.cardEnabled)&&<p className="empty-state">导入课表模板可自动生成卡片，也可点击“手动添加卡片”单独创建。</p>}</details></>}
    {term&&tab==='terms'&&<section className="workspace-card admin-course-panel"><div className="section-heading"><div><h2>学期与教学日历</h2><p>{term.academicYear} · {term.name} · 北京时间</p></div><button className="secondary-button" onClick={()=>setTermEdit(term)}>编辑学期与校历</button></div><AcademicCalendar term={term}/></section>}
    {importSource&&term&&<ImportDialog term={term} source={importSource} admin onClose={()=>setImportSource(null)} onSaved={saved}/>}
    {termEdit&&<TermEditor term={termEdit==='new'?null:termEdit} onClose={()=>setTermEdit(null)} onSaved={id=>{setTermEdit(null);void loadTerms(id);setNotice('学期配置已保存。');window.dispatchEvent(new Event('timetable-terms-changed'));}}/>}
    {courseEdit&&term&&<CardCourseEditor title={courseEdit==='new'?'手动添加卡片模板':'编辑卡片模板'} course={courseEdit==='new'?emptyCourse():courseEdit} term={term} busy={busy} error={editError} onClose={()=>setCourseEdit(null)} onSave={c=>void saveCourse(c)} extra={<>{courseEdit!=='new'&&<PreviewIssues preview={{courses:[courseEdit],warnings:[],conflicts:[]}}/>}<p className="notice">{courseEdit==='new'||courseEdit.origin==='manual'?'手动卡片修改后同步直接选用它的用户，模板中的课程安排独立保留。':'保存后同步课程卡片、引用它的模板及已选用户，个人安排仍优先保留。'}</p><label className="checkbox-line"><input type="checkbox" checked={published} onChange={e=>setPublished(e.target.checked)}/><span>发布卡片，允许学生选用</span></label><label className="checkbox-line"><input type="checkbox" required/><span>我已核对修改内容，允许暂缺的时间继续标为待安排。</span></label></>}/>}
    {templateDelete&&<DeleteTemplateDialog template={templateDelete} onClose={()=>setTemplateDelete(null)} onDeleted={()=>{setTemplateDelete(null);saved('模板已删除，课程卡片和用户已添加的课程均已保留。');}}/>}
    {templateEdit&&term&&<TemplateEditor template={templateEdit==='new'?null:templateEdit} term={term} courses={courses} onClose={()=>setTemplateEdit(null)} onSaved={()=>{setTemplateEdit(null);saved('模板已保存，课程成员已同步到选用用户，额外新增课程与个人调整保留。');}}/>}
  </div>;
}
function TemplateEditor({template,term,courses,onClose,onSaved}:{template:Template|null;term:Term;courses:Course[];onClose:()=>void;onSaved:()=>void}){
  const [name,setName]=useState(template?.name||''),[ids,setIds]=useState<string[]>(template?.courseIds||[]),[published,setPublished]=useState(template?.published??true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [changes,setChanges]=useState<Record<string,{course:CourseData;revision:number}>>({}),[editingCourse,setEditingCourse]=useState<Course|null>(null),[checking,setChecking]=useState(false),[courseError,setCourseError]=useState('');
  const courseOptions=courses.map(course=>template?.courses?.find(c=>c.id===course.id)||course);
  async function save(e:FormEvent){e.preventDefault();if(busy||checking)return;setBusy(true);setError('');try{await api(template?`/admin/timetable/templates/${template.id}`:'/admin/timetable/templates',template?'PUT':'POST',{termId:term.id,name,courseIds:ids,published,revision:template?.revision,acceptWarnings:true,courseChanges:Object.entries(changes).filter(([id])=>ids.includes(id)).map(([id,c])=>({id,...c}))});onSaved();}catch(err){setError(errorMessage(err));}finally{setBusy(false);}}
  async function stageCourse(course:CourseData){
    if(!editingCourse||checking)return;setChecking(true);setCourseError('');
    try{const preview=await api<Preview>('/admin/timetable/preview','POST',{termId:term.id,source:'manual',courses:[course]});const id=editingCourse.id;setChanges(old=>({...old,[id]:{course:preview.courses[0],revision:editingCourse.revision||0}}));setEditingCourse(null);}
    catch(e){setCourseError(errorMessage(e));}finally{setChecking(false);}
  }
  return <><Modal title={template?'编辑模板':'创建学期模板'} onClose={onClose} busy={busy||checking}><form className="manage-form" onSubmit={save}><p className="muted-note">{term.academicYear} · {term.name}</p><label>模板名称<input required maxLength={80} placeholder="例如 模板一" value={name} onChange={e=>setName(e.target.value)}/></label><p className="notice">可编辑模板内的课程。修改会在保存模板后生效。模板生成的课程会同步到卡片及已选用户；手动卡片课程在本模板中独立维护，个人安排继续优先。</p><div className="template-course-options">{courseOptions.filter(c=>c.cardEnabled||ids.includes(c.id)).map(original=>{const c={...original,...changes[original.id]?.course,id:original.id,revision:original.revision};return <div className="template-edit-course" key={c.id}><label className="checkbox-line"><input type="checkbox" checked={ids.includes(c.id)} disabled={busy||!c.published&&!ids.includes(c.id)} onChange={e=>setIds(e.target.checked?[...ids,c.id]:ids.filter(id=>id!==c.id))}/><span>{c.course_name}<small>{c.teacher||'待确认'}{c.published?'':' · 已下架'}{changes[c.id]?' · 课程修改待保存':''}</small></span></label>{template&&<button type="button" className="text-button" disabled={busy||!ids.includes(c.id)} onClick={()=>{setEditingCourse(c);setCourseError('');}}>编辑课程</button>}</div>;})}</div><label className="checkbox-line"><input type="checkbox" checked={published} onChange={e=>setPublished(e.target.checked)}/><span>发布模板，允许学生选择</span></label>{error&&<p className="feedback" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>取消</button><button className="primary-button compact" disabled={busy||!ids.length}>{busy?'正在保存…':'保存模板'}</button></div></form></Modal>{editingCourse&&<CardCourseEditor title="编辑模板课程" course={editingCourse} term={term} busy={checking} error={courseError} onClose={()=>setEditingCourse(null)} onSave={course=>void stageCourse(course)} extra={<><p className="notice">这里先核对课程，回到模板后点击“保存模板”统一生效。</p><label className="checkbox-line"><input type="checkbox" required/><span>我已核对课程和上课安排；暂缺信息保留待安排。</span></label></>}/>}</>;
}

function DeleteTemplateDialog({template,onClose,onDeleted}:{template:Template;onClose:()=>void;onDeleted:()=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const deleting=useRef(false);
  async function remove(){
    if(deleting.current)return;
    deleting.current=true;setBusy(true);setError('');
    try{await api(`/admin/timetable/templates/${template.id}`,'DELETE',{revision:template.revision,confirm:true});onDeleted();}
    catch(e){setError(errorMessage(e));}
    finally{deleting.current=false;setBusy(false);}
  }
  return <Modal title="删除课表模板" onClose={onClose} busy={busy}><div className="manage-form"><p>确定删除模板“{template.name}”吗？</p><p className="delete-warning">删除后无法撤销，用户将不能再选择这份模板。</p><p>课程卡片、作业和用户已添加的课程都会保留。已选课程继续跟随课程卡片更新，个人调整也会保留；其他模板不受影响。</p>{error&&<p className="feedback" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="primary-button compact danger-button" disabled={busy} onClick={()=>void remove()}>{busy?'正在删除…':'确认删除模板'}</button></div></div></Modal>;
}
