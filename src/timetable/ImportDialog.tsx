import { useRef, useState } from 'react';
import {TimetablePasteField} from './TimetablePasteField';
import { Check, Copy } from 'lucide-react';
import { api } from '../services/auth';
import { Modal } from '../components/Modal';
import { CourseEditor } from './CourseEditor';
import {CardCourseEditor} from './CardCourseEditor';
import {useMobileLayout} from '../components/useMobileLayout';
import { CourseWeekdays } from './CourseWeekdays';
import { weekdayLabel } from './date';
import { importSaveIssue } from './import-save';
import { errorMessage, type Course, type CourseData, type Preview, type Source, type Term, type TimetableView } from './types';

export function PreviewIssues({preview}:{preview:Preview}){
  const issues=[...preview.warnings,...preview.courses.flatMap(c=>c.warnings.map(w=>`${c.course_name}：${w}`))];
  const notes=preview.courses.flatMap(c=>(c.notices||[]).map(note=>`${c.course_name}：${note}`));
  return <>
    {preview.importError&&<p className="feedback" role="alert">{preview.importError}</p>}
    {!!notes.length&&<details className="review-issues schedule-notices"><summary>{notes.length} 条排课说明</summary><ul>{notes.map((note,i)=><li key={i}>{note}</li>)}</ul></details>}
    {!!preview.unparsedItems?.length&&<details className="review-issues" open><summary>{preview.unparsedItems.length} 条未纳入课表的内容，请核对</summary>{preview.unparsedItems.map((item,i)=><div className="unparsed-course-item" key={i}><p>{item.reason||'原因未明确，请与原始页面核对。'}</p><pre>{item.raw||'原文未提供'}</pre></div>)}</details>}
    {!!issues.length&&<details className="review-issues" open><summary>{issues.length} 条补充信息</summary><ul>{issues.map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
    {!!preview.conflicts.length&&<details className="review-issues conflict-box" open><summary>{preview.conflicts.length} 处课程时间重叠</summary><ul>{preview.conflicts.map((c,i)=><li key={i}>{c.date}：{c.first} / {c.second}</li>)}</ul></details>}
  </>;
}
function CourseDateReview({course}:{course:Course}){
  const labels={added:'独立日期已排入',merged:'合并为一次课',weekly_preferred:'采用周次安排',pending:'待补充确认'};
  return <>
    {!!course.date_reviews?.length&&<details className="ai-course-arrangements date-review-details"><summary>核对 {course.date_reviews.length} 条备注日期处理</summary><ul>{course.date_reviews.map((review,i)=><li key={i}><strong>{review.date||'日期待确认'} · {labels[review.action]}</strong><p>{review.weekly_date&&`实际采用 ${review.weekly_date}：`}{review.reason}</p></li>)}</ul></details>}
    {Boolean(course.schedule_raw||course.remarks_raw||course.source_rows?.length)&&<details className="ai-course-arrangements"><summary>核对原始上课信息与备注</summary>{course.schedule_raw&&<p className="schedule-raw-text">{course.schedule_raw}</p>}{course.remarks_raw&&<p className="schedule-raw-text">{course.remarks_raw}</p>}{course.source_rows?.map((row,i)=><p className="schedule-raw-text" key={i}>{row.source}{row.row?` · 第 ${row.row} 行`:''}：{row.raw}</p>)}</details>}
  </>;
}
export function ImportDialog({term,source,admin=false,current,onClose,onSaved}:{term:Term;source:'ai';admin?:boolean;current?:TimetableView|null;onClose:()=>void;onSaved:(message:string)=>void}){
  const mobile=useMobileLayout();
  const Editor=mobile&&!admin?CardCourseEditor:CourseEditor;
  const mode=source;
  const [text,setText]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null),[accepted,setAccepted]=useState(true),[templateName,setTemplateName]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[copyMessage,setCopyMessage]=useState('');
  const [editing,setEditing]=useState<{course:CourseData;index:number}|null>(null),[prompt,setPrompt]=useState('');
  const [promptBusy,setPromptBusy]=useState(false);
  const working=busy;
  const templateNameInput=useRef<HTMLInputElement>(null),confirmationInput=useRef<HTMLInputElement>(null),previewButton=useRef<HTMLButtonElement>(null);
  const saveIssue=importSaveIssue({admin,name:templateName,preview,accepted});
  const prefix=admin?'/admin/timetable':'/timetable';
  async function inspect(courses?:CourseData[]){
    if(working)return false;
    setBusy(true);setError('');setAccepted(true);
    try{const p=await api<Preview>(prefix+(admin?'/template-preview':'/preview'),'POST',{termId:term.id,source:mode,text,...(courses?{courses,unparsedItems:preview?.unparsedItems,importWarnings:preview?.importWarnings}:{})});setPreview(p);return true;}catch(e){setError(errorMessage(e));return false;}finally{setBusy(false);}
  }
  async function loadPrompt(){
    const p=await api<{text:string}>('/timetable/prompt?termId='+encodeURIComponent(term.id));setPrompt(p.text);return p.text;
  }
  async function viewPrompt(){if(promptBusy)return;setPromptBusy(true);try{await loadPrompt();}catch(e){setError(errorMessage(e));}finally{setPromptBusy(false);}}
  async function copyPrompt(){
    setPromptBusy(true);setError('');try{const value=await loadPrompt();try{await navigator.clipboard.writeText(value);setCopyMessage('提示词已复制。把它和学校“我的课程”整页文字一起发给豆包或其他 AI。');}catch{setCopyMessage('请展开下方完整提示词，长按或全选后手动复制。');}}catch(e){setError(errorMessage(e));}finally{setPromptBusy(false);}
  }
  async function save(){if(working)return;if(saveIssue){setError(saveIssue.message);const target=saveIssue.target==='name'?templateNameInput.current:saveIssue.target==='confirmation'?confirmationInput.current:previewButton.current;target?.focus();target?.scrollIntoView({block:'center'});return;}if(!preview)return;setBusy(true);setError('');
    try{if(admin){const r=await api<{name:string;courseCount:number;created:number;reused:number;cardsCreated:number}>('/admin/timetable/template-import','POST',{termId:term.id,name:templateName,source:mode,courses:preview.courses,catalogVersion:preview.catalogVersion,acceptWarnings:accepted});onSaved(`模板“${r.name}”已保存，共 ${r.courseCount} 门课程；新增 ${r.created} 门、复用 ${r.reused} 门，生成 ${r.cardsCreated} 张卡片。可继续导入其他同学的课表模板。`);}
      else{const r=await api<TimetableView>(`/timetable/${term.id}`,'POST',{source:mode as Source,courses:preview.courses,revision:current?.timetable?.revision||0,acceptWarnings:accepted});onSaved(`已添加 ${r.added||0} 门课程，原有课程已保留。`);}onClose();
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  return <><Modal title={admin?'导入课表模板':'导入本学期课表'} onClose={onClose} busy={working}><div className="manage-form import-course-dialog">
    <p className="muted-note">{term.academicYear} · {term.name}{admin?' · 同一学年可保存多份模板，每份归入所选学期':' · 学期由管理员统一设置，导入内容自动归入此学期'}</p>
    {admin&&<><label>模板名称（必填）<input ref={templateNameInput} required maxLength={80} placeholder="例如：模板一" value={templateName} disabled={working} onChange={e=>{setTemplateName(e.target.value);setError('');}}/></label><p className="notice">不同同学分别导入并命名，保留各自课程组合；名称、时间和老师一致时复用同一张卡片。不会用新导入的安排覆盖已有卡片。</p></>}
    {mode==='ai'&&<div className="ai-import-flow"><section className="ai-import-step"><div className="ai-step-heading"><span className="ai-step-number">1</span><div><h3>先交给豆包或其他 AI 整理</h3><p>复制提示词，再把学校“我的课程”整页文字一起发给 AI。</p></div></div><div className="ai-copy-instructions">打开学校的“<a href="https://yjsy.zju.edu.cn/dashboard/analysis" target="_blank" rel="noopener noreferrer" title="在新标签页打开研究生信息管理系统">研究生信息管理系统</a> → 我的课程”页面，在页面中按 <kbd>Ctrl+A</kbd> 全选，再按 <kbd>Ctrl+C</kbd> 复制，不用逐门选择课程。手机可以长按页面文字后全选复制。</div><button type="button" className="primary-button ai-flow-action" disabled={working||promptBusy} onClick={()=>void copyPrompt()}><Copy size={17}/>{promptBusy?'正在准备提示词…':'点击这里复制提示词'}</button><details className="ai-full-prompt" onToggle={e=>{if(e.currentTarget.open)void viewPrompt();}}><summary>也可在这里查看完整提示词</summary>{promptBusy&&!prompt?<p>正在读取提示词…</p>:<textarea aria-label="完整课程整理提示词" readOnly rows={8} value={prompt}/>}</details>{copyMessage&&<p className="notice" role="status">{copyMessage}</p>}</section><section className="ai-import-step"><div className="ai-step-heading"><span className="ai-step-number">2</span><div><h3>把 AI 整理好的内容粘贴到这里</h3><p>完整复制从【课表开始】到【课表结束】的内容，回来查看课程安排。</p></div></div><TimetablePasteField value={text} disabled={working} onChange={value=>{setText(value);setPreview(null);setAccepted(true);setError('');}}/><button type="button" className="primary-button ai-flow-action" ref={previewButton} disabled={working||!text.trim()} onClick={()=>void inspect()}>{busy?'正在生成安排…':preview?'重新查看安排':'查看安排'}</button></section><p className="notice">AI 按每次课整理日期、周次、星期、地点和起止时间，同一次课只计一次。日期或时间尚未明确的安排会保留为待安排；跨年的明确日期也会保留。</p><p className="muted-note">提示词会带上本学期的教学日历和作息。网站负责生成安排与校验，资料由你自行交给外部 AI 整理。</p></div>}
    {admin&&<p className="muted-note">模板中的课程会自动生成卡片。按同学期的课程名称、完整上课时间和教师匹配，信息不足时保留独立课程，可稍后补充。</p>}
    {preview&&<>{admin&&preview.stats&&<div className="notice">将新增 {preview.stats.newCourses} 门课程，复用 {preview.stats.reusedCourses} 门已有课程卡片。{preview.stats.reusedCourses>0&&'已有卡片的安排以本次预览为准，如需修改请到模板页的卡片中编辑。'}</div>}<div className="preview-heading"><strong>预览 {preview.courses.length} 门课程</strong><span>默认已核对，可按需修改</span></div><div className="preview-course-list">{preview.courses.map((c,i)=><article key={i}><div><strong>{c.course_name}</strong><CourseWeekdays sessions={c.sessions}/><p>{c.teacher||'老师待确认'} · {c.sessions.length} 次已确定安排</p><span className={c.schedule_status==='ready'?'role-badge':'pending-status'}>{c.schedule_status==='pending'?'已核对 · 时间待安排':'已核对'}{admin?c.importAction==='reuse'?' · 复用已有卡片':' · 自动生成新卡片':c.matchedCourseId?' · 已匹配课程':''}</span>{c.sessions.length>0&&<details className="ai-course-arrangements"><summary>查看全部 {c.sessions.length} 次上课安排</summary><ol>{c.sessions.map((session,j)=><li key={j}><time dateTime={session.date}>{session.date} · {weekdayLabel(session.date)}</time> · 第 {session.lesson_number??j+1} 次课 · {session.start_time}—{session.end_time} · {session.kind==='practice'?'实践活动，不在教室授课':session.room||'地点待通知'}</li>)}</ol></details>}<CourseDateReview course={c}/></div><div className="row-actions">{(!admin||c.importAction!=='reuse')&&<button type="button" onClick={()=>setEditing({course:c,index:i})}>校对</button>}<button type="button" className="danger-text" disabled={working} onClick={()=>void inspect(preview.courses.filter((_,j)=>j!==i))}>移除</button></div></article>)}</div><PreviewIssues preview={preview}/><label className="checkbox-line"><input ref={confirmationInput} type="checkbox" checked={accepted} onChange={e=>{setAccepted(e.target.checked);setError('');}}/><span>默认已核对，可直接保存；需要调整时可编辑课程，缺少时间的课程仍保留为待安排。</span></label></>}
    {error&&<p className="feedback" role="alert">{error}</p>}
    {(mode!=='ai'||preview)&&<p id="timetable-save-hint" className="muted-note" role="status">{working?'正在处理，请稍候…':saveIssue?.message||'已完成核对，可以保存。'}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={working}>取消</button>{(mode!=='ai'||preview)&&<button type="button" className="primary-button compact" disabled={working} aria-describedby="timetable-save-hint" onClick={()=>void save()}><Check size={16}/>{busy?'正在处理…':admin?'保存模板并生成卡片':'确认保存课表'}</button>}</div>
  </div></Modal>{editing&&<Editor course={editing.course} term={term} busy={working} onClose={()=>setEditing(null)} onSave={async c=>{const courses:CourseData[]=preview?.courses?[...preview.courses]:[];courses[editing.index]=c;if(await inspect(courses))setEditing(null);}}/>}</>;
}
