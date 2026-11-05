import { useRef, useState } from 'react';
import { Check, Copy, FileSpreadsheet, Upload } from 'lucide-react';
import { api } from '../services/auth';
import { Modal } from '../components/Modal';
import { CourseEditor } from './CourseEditor';
import { CourseWeekdays } from './CourseWeekdays';
import { weekdayLabel } from './date';
import { errorMessage, type Course, type CourseData, type Preview, type Source, type Term, type TimetableView } from './types';

export function PreviewIssues({preview}:{preview:Preview}){
  const issues=[...preview.warnings,...preview.courses.flatMap(c=>c.warnings.map(w=>`${c.course_name}：${w}`))];
  const notes=preview.courses.flatMap(c=>(c.notices||[]).map(note=>`${c.course_name}：${note}`));
  return <>
    {preview.importError&&<p className="feedback" role="alert">{preview.importError}</p>}
    {!!notes.length&&<details className="review-issues schedule-notices"><summary>{notes.length} 条排课说明</summary><ul>{notes.map((note,i)=><li key={i}>{note}</li>)}</ul></details>}
    {!!preview.unparsedItems?.length&&<details className="review-issues" open><summary>{preview.unparsedItems.length} 条未纳入课表的内容，请核对</summary>{preview.unparsedItems.map((item,i)=><div className="unparsed-course-item" key={i}><p>{item.reason||'原因未明确，请与原始页面核对。'}</p><pre>{item.raw||'原文未提供'}</pre></div>)}</details>}
    {!!issues.length&&<details className="review-issues" open><summary>{issues.length} 条信息需要核对</summary><ul>{issues.map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
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
export function ImportDialog({term,source,admin=false,current,onClose,onSaved}:{term:Term;source:'ai'|'excel';admin?:boolean;current?:TimetableView|null;onClose:()=>void;onSaved:(message:string)=>void}){
  const [mode,setMode]=useState(source),[text,setText]=useState(''),[files,setFiles]=useState<{name:string;content:string}[]>([]);
  const [preview,setPreview]=useState<Preview|null>(null),[accepted,setAccepted]=useState(false),[templateName,setTemplateName]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[copyMessage,setCopyMessage]=useState('');
  const [editing,setEditing]=useState<{course:CourseData;index:number}|null>(null),[prompt,setPrompt]=useState('');
  const [promptBusy,setPromptBusy]=useState(false);
  const fileRequest=useRef(0);
  const prefix=admin?'/admin/timetable':'/timetable';
  async function readFiles(selected:FileList|null){
    if(!selected)return;const request=++fileRequest.current;setFiles([]);setError('');setPreview(null);setAccepted(false);if(selected.length>5){setError('每次最多选择 5 个需要合并的文件。');return;}if(Array.from(selected).reduce((n,f)=>n+f.size,0)>6*1024*1024){setError('本次文件总大小不能超过 6 MB。');return;}
    try{const list=await Promise.all(Array.from(selected).map(async file=>{if(file.size>2*1024*1024)throw new Error('单个文件不能超过 2 MB。');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return{name:file.name,content:btoa(binary)};}));if(request===fileRequest.current)setFiles(list);}catch(e){if(request===fileRequest.current)setError(errorMessage(e));}
  }
  async function inspect(courses?:CourseData[]){
    setBusy(true);setError('');setAccepted(false);
    try{const p=await api<Preview>(prefix+(admin?'/template-preview':'/preview'),'POST',{termId:term.id,source:mode,text,files,...(courses?{courses,unparsedItems:preview?.unparsedItems,importWarnings:preview?.importWarnings}:{})});setPreview(p);return true;}catch(e){setError(errorMessage(e));return false;}finally{setBusy(false);}
  }
  async function loadPrompt(){
    const p=await api<{text:string}>('/timetable/prompt');const context=JSON.stringify({academic_year:term.academicYear,semester:term.name,calendars:term.config.calendars,periods:term.config.periods},null,2);
    const value=p.text.replace('下面是待解析的原始课表内容：',`网站目标学年：${term.academicYear}\n网站目标学期：${term.name}\n以下是网站已经配置的教学日历和作息，可用于准确匹配课程规则，不代表学生已选课程，也不作为过滤明确上课日期的范围：\n${context}\n\n下面是待解析的原始课表内容：`);setPrompt(value);return value;
  }
  async function viewPrompt(){if(promptBusy)return;setPromptBusy(true);try{await loadPrompt();}catch(e){setError(errorMessage(e));}finally{setPromptBusy(false);}}
  async function copyPrompt(){
    setPromptBusy(true);setError('');try{const value=await loadPrompt();try{await navigator.clipboard.writeText(value);setCopyMessage('提示词已复制。把它和学校“我的课程”整页文字一起发给豆包或其他 AI。');}catch{setCopyMessage('请展开下方完整提示词，长按或全选后手动复制。');}}catch(e){setError(errorMessage(e));}finally{setPromptBusy(false);}
  }
  async function save(){if(!preview||preview.importBlocked||!accepted||busy)return;setBusy(true);setError('');
    try{if(admin){const r=await api<{name:string;courseCount:number;created:number;reused:number;cardsCreated:number}>('/admin/timetable/template-import','POST',{termId:term.id,name:templateName,source:mode,courses:preview.courses,catalogVersion:preview.catalogVersion,acceptWarnings:accepted});onSaved(`模板“${r.name}”已保存，共 ${r.courseCount} 门课程；新增 ${r.created} 门、复用 ${r.reused} 门，生成 ${r.cardsCreated} 张卡片。可继续导入其他同学的课表模板。`);}
      else{const r=await api<TimetableView>(`/timetable/${term.id}`,'POST',{source:mode as Source,courses:preview.courses,revision:current?.timetable?.revision||0,acceptWarnings:accepted});onSaved(`已添加 ${r.added||0} 门课程，原有课程已保留。`);}onClose();
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  return <><Modal title={admin?'导入课表模板':'导入本学期课表'} onClose={onClose} busy={busy}><div className="manage-form import-course-dialog">
    <p className="muted-note">{term.academicYear} · {term.name}{admin?' · 同一学年可保存多份模板，每份归入所选学期':' · 学期由管理员统一设置，导入内容自动归入此学期'}</p>
    {admin&&<><label>模板名称<input required maxLength={80} placeholder="例如：模板一" value={templateName} disabled={busy} onChange={e=>setTemplateName(e.target.value)}/></label><p className="notice">不同同学分别导入并命名，保留各自课程组合；重合上课班自动复用同一张卡片。不会用新导入的安排覆盖已有卡片。</p></>}
    {admin&&<div className="segmented small-segmented" role="group" aria-label="模板导入方式">{(['ai','excel'] as const).map(s=><button type="button" className={mode===s?'active':''} aria-pressed={mode===s} key={s} disabled={busy} onClick={()=>{fileRequest.current++;setMode(s);setText('');setFiles([]);setPreview(null);setAccepted(false);setError('');}}>{s==='ai'?'AI 内容导入':'Excel 导入'}</button>)}</div>}
    {mode==='ai'&&<div className="ai-import-flow"><section className="ai-import-step"><div className="ai-step-heading"><span className="ai-step-number">1</span><div><h3>先交给豆包或其他 AI 整理</h3><p>复制提示词，再把学校“我的课程”整页文字一起发给 AI。</p></div></div><div className="ai-copy-instructions">打开学校的“<a href="https://yjsy.zju.edu.cn/dashboard/analysis" target="_blank" rel="noopener noreferrer" title="在新标签页打开研究生信息管理系统">研究生信息管理系统</a> → 我的课程”页面，在页面中按 <kbd>Ctrl+A</kbd> 全选，再按 <kbd>Ctrl+C</kbd> 复制，不用逐门选择课程。手机可以长按页面文字后全选复制。</div><button type="button" className="primary-button ai-flow-action" disabled={busy||promptBusy} onClick={()=>void copyPrompt()}><Copy size={17}/>{promptBusy?'正在准备提示词…':'点击这里复制提示词'}</button><details className="ai-full-prompt" onToggle={e=>{if(e.currentTarget.open)void viewPrompt();}}><summary>也可在这里查看完整提示词</summary>{promptBusy&&!prompt?<p>正在读取提示词…</p>:<textarea aria-label="完整课程整理提示词" readOnly rows={8} value={prompt}/>}</details>{copyMessage&&<p className="notice" role="status">{copyMessage}</p>}</section><section className="ai-import-step"><div className="ai-step-heading"><span className="ai-step-number">2</span><div><h3>把 AI 整理好的内容粘贴到这里</h3><p>完整复制从【课表开始】到【课表结束】的内容，回来查看课程安排。</p></div></div><label className="ai-result-label">AI 整理结果<textarea aria-label="AI 整理的课表内容" rows={8} placeholder="粘贴从【课表开始】到【课表结束】的全部内容" value={text} disabled={busy} onChange={e=>{setText(e.target.value);setPreview(null);setAccepted(false);setError('');}}/></label><button type="button" className="primary-button ai-flow-action" disabled={busy||!text.trim()} onClick={()=>void inspect()}>{busy?'正在生成安排…':preview?'重新查看安排':'查看安排'}</button></section><p className="notice">周次安排与明确日期合并生成，同一次课只计一次。跨日期区间、跨年的明确日期会保留；已明确的同课次冲突以上课周为准，原文仍可核对。</p><p className="muted-note">提示词会带上本学期的教学日历和作息。网站负责生成安排与校验，资料由你自行交给外部 AI 整理。</p></div>}
    {mode==='excel'&&<><label className="file-drop"><FileSpreadsheet size={28}/><strong>{admin?'选择一位同学的 Excel 课表（可同时选两份）':'选择 Excel 课表（可同时选两份）'}</strong><span>支持 .xls、.xlsx，每次最多 5 个、单个 2 MB</span><input type="file" accept=".xls,.xlsx" multiple onChange={e=>void readFiles(e.target.files)} disabled={busy}/></label>{!!files.length&&<div className="notice">本次选择 {files.length} 个文件，将合并解析为{admin?'一份模板':'当前学期的一份课表'}。{files.map((file,i)=><p className="import-file-name" key={i}>{i+1}. {file.name}</p>)}</div>}<p className="muted-note">{admin?'同一位同学的两份表格可一次合并，不同同学请分别创建模板。':'两份表格一起选择，全部课程合并归入当前学期，不按原表标签拆分。'}“自定义周次”不会自动解释成每周上课。</p></>}
    {mode==='excel'&&<p className="muted-note">本次文件总大小不超过 6 MB。</p>}
    {mode==='excel'&&<button type="button" className="secondary-button" disabled={busy||!files.length} onClick={()=>void inspect()}><Upload size={15}/>{busy?'正在检查…':'识别并预览'}</button>}
    {admin&&<p className="muted-note">模板中的课程会自动生成卡片。优先按同学期上课班编号去重；缺少班号时，仅在老师和完整上课安排一致时复用，信息不足会提示核对。</p>}
    {preview&&<>{admin&&preview.stats&&<div className="notice">将新增 {preview.stats.newCourses} 门课程，复用 {preview.stats.reusedCourses} 门已有课程卡片。{preview.stats.reusedCourses>0&&'已有卡片的安排以本次预览为准，如需修改请到模板页的卡片中编辑。'}</div>}<div className="preview-heading"><strong>预览 {preview.courses.length} 门课程</strong><span>核对安排后再保存</span></div><div className="preview-course-list">{preview.courses.map((c,i)=><article key={i}><div><strong>{c.course_name}</strong><CourseWeekdays sessions={c.sessions}/><p>{c.teacher||'老师待确认'} · 班号 {c.teaching_class_code||'待确认'} · {c.sessions.length} 次已确定安排</p><span className={c.schedule_status==='ready'?'role-badge':'pending-status'}>{c.schedule_status==='ready'?'安排已明确':c.schedule_status==='pending'?'待安排':'需核对'}{admin?c.importAction==='reuse'?' · 复用已有卡片':' · 自动生成新卡片':c.matchedCourseId?' · 已匹配上课班':''}</span>{c.sessions.length>0&&<details className="ai-course-arrangements"><summary>查看全部 {c.sessions.length} 次上课安排</summary><ol>{c.sessions.map((session,j)=><li key={j}><time dateTime={session.date}>{session.date} · {weekdayLabel(session.date)}</time> · 第 {session.lesson_number??j+1} 次课 · {session.start_time}—{session.end_time} · {session.kind==='practice'?'实践活动，不在教室授课':session.room||'地点待通知'}</li>)}</ol></details>}<CourseDateReview course={c}/></div><div className="row-actions">{(!admin||c.importAction!=='reuse')&&<button type="button" onClick={()=>setEditing({course:c,index:i})}>校对</button>}<button type="button" className="danger-text" disabled={busy} onClick={()=>void inspect(preview.courses.filter((_,j)=>j!==i))}>移除</button></div></article>)}</div><PreviewIssues preview={preview}/><label className="checkbox-line"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>我已核对上课班、日期及缺失信息，确认保存；缺少时间的课程先留在待安排。</span></label></>}
    {error&&<p className="feedback" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>取消</button>{(mode!=='ai'||preview)&&<button type="button" className="primary-button compact" disabled={busy||!preview||preview.importBlocked||!accepted||admin&&!templateName.trim()} onClick={()=>void save()}><Check size={16}/>{busy?'正在处理…':admin?'保存模板并生成卡片':'确认保存课表'}</button>}</div>
  </div></Modal>{editing&&<CourseEditor course={editing.course} term={term} busy={busy} onClose={()=>setEditing(null)} onSave={async c=>{const courses:CourseData[]=preview?.courses?[...preview.courses]:[];courses[editing.index]=c;if(await inspect(courses))setEditing(null);}}/>}</>;
}
