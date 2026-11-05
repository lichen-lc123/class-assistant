import { useState } from 'react';
import { Check, Copy, FileSpreadsheet, Plus, Upload } from 'lucide-react';
import { api } from '../services/auth';
import { Modal } from '../components/Modal';
import { CourseEditor } from './CourseEditor';
import { emptyCourse, errorMessage, type CourseData, type Preview, type Source, type Term, type TimetableView } from './types';

export function PreviewIssues({preview}:{preview:Preview}){
  const issues=[...preview.warnings,...preview.courses.flatMap(c=>c.warnings.map(w=>`${c.course_name}：${w}`))];
  return <>{issues.length>0&&<details className="review-issues" open><summary>{issues.length} 条信息需要核对</summary><ul>{issues.map((s,i)=><li key={i}>{s}</li>)}</ul></details>}{preview.conflicts.length>0&&<details className="review-issues conflict-box" open><summary>{preview.conflicts.length} 处时间冲突</summary><ul>{preview.conflicts.map((c,i)=><li key={i}>{c.date}：{c.first} / {c.second}</li>)}</ul></details>}</>;
}
export function ImportDialog({term,source,admin=false,current,onClose,onSaved}:{term:Term;source:'ai'|'excel'|'manual';admin?:boolean;current?:TimetableView|null;onClose:()=>void;onSaved:(message:string)=>void}){
  const [mode,setMode]=useState(source),[text,setText]=useState(''),[files,setFiles]=useState<{name:string;content:string}[]>([]);
  const [preview,setPreview]=useState<Preview|null>(null),[accepted,setAccepted]=useState(false),[templateName,setTemplateName]=useState(''),[description,setDescription]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[copyMessage,setCopyMessage]=useState('');
  const [editing,setEditing]=useState<{course:CourseData;index:number}|null>(null),[prompt,setPrompt]=useState('');
  const [promptBusy,setPromptBusy]=useState(false);
  const prefix=admin?'/admin/timetable':'/timetable';
  async function readFiles(selected:FileList|null){
    if(!selected)return;setError('');setPreview(null);if(selected.length>5){setError('每次最多选择 5 个同学期文件。');return;}if(Array.from(selected).reduce((n,f)=>n+f.size,0)>6*1024*1024){setError('本次文件总大小不能超过 6 MB。');return;}
    try{const list=await Promise.all(Array.from(selected).map(async file=>{if(file.size>2*1024*1024)throw new Error('单个文件不能超过 2 MB。');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return{name:file.name,content:btoa(binary)};}));setFiles(list);}catch(e){setError(errorMessage(e));}
  }
  async function inspect(courses?:CourseData[]){
    setBusy(true);setError('');setAccepted(false);
    try{const p=await api<Preview>(prefix+(admin?'/template-preview':'/preview'),'POST',{termId:term.id,source:mode,text,files,...(courses?{courses}:{})});setPreview(p);return true;}catch(e){setError(errorMessage(e));return false;}finally{setBusy(false);}
  }
  async function loadPrompt(){
    const p=await api<{text:string}>('/timetable/prompt');const context=JSON.stringify({academic_year:term.academicYear,semester:term.name,aliases:term.config.aliases,calendars:term.config.calendars,periods:term.config.periods},null,2);
    const value=p.text.replace('下面是待解析的原始课表内容：',`网站目标学年：${term.academicYear}\n网站目标学期：${term.name}\n以下是网站已经配置的教学日历和作息，可用于准确匹配课程规则，不代表学生已选课程：\n${context}\n\n下面是待解析的原始课表内容：`);setPrompt(value);return value;
  }
  async function viewPrompt(){if(prompt||promptBusy)return;setPromptBusy(true);try{await loadPrompt();}catch(e){setError(errorMessage(e));}finally{setPromptBusy(false);}}
  async function copyPrompt(){
    setPromptBusy(true);setError('');try{const value=prompt||await loadPrompt();try{await navigator.clipboard.writeText(value);setCopyMessage('提示词已复制。把它和学校“我的课程”整页文字一起发给豆包或其他 AI。');}catch{setCopyMessage('请展开下方完整提示词，长按或全选后手动复制。');}}catch(e){setError(errorMessage(e));}finally{setPromptBusy(false);}
  }
  async function readJsonFile(file?:File){
    if(!file)return;
    if(file.size>2*1024*1024){setError('整理结果文件不能超过 2 MB。');return;}
    try{setText(await file.text());setPreview(null);setAccepted(false);setError('');}catch{setError('文件读取失败，请重选或直接粘贴内容。');}
  }
  async function save(){if(!preview||!accepted||busy)return;setBusy(true);setError('');
    try{if(admin){const r=await api<{name:string;courseCount:number;created:number;reused:number;cardsCreated:number}>('/admin/timetable/template-import','POST',{termId:term.id,name:templateName,description,source:mode,courses:preview.courses,catalogVersion:preview.catalogVersion,acceptWarnings:accepted});onSaved(`模板“${r.name}”已保存，共 ${r.courseCount} 门课程；新增 ${r.created} 门、复用 ${r.reused} 门，生成 ${r.cardsCreated} 张卡片。可继续导入其他同学的课表模板。`);}
      else{const r=await api<TimetableView>(`/timetable/${term.id}`,'POST',{source:mode as Source,courses:preview.courses,revision:current?.timetable?.revision||0,acceptWarnings:accepted});onSaved(`已加入 ${r.added||0} 门课程，重复跳过 ${r.skipped||0} 门。`);}onClose();
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  return <><Modal title={admin?'导入课表模板':'导入本学期课表'} onClose={onClose} busy={busy}><div className="manage-form import-course-dialog">
    <p className="muted-note">{term.academicYear} · {term.name}{admin?' · 一位同学的课表保存为一份模板，支持多份模板':' · 学期由管理员统一设置，导入内容自动归入此学期'}</p>
    {admin&&<><label>模板名称<input required maxLength={80} placeholder="例如：模板一" value={templateName} disabled={busy} onChange={e=>setTemplateName(e.target.value)}/></label><label>适用说明（可选）<textarea rows={2} maxLength={500} value={description} disabled={busy} onChange={e=>setDescription(e.target.value)}/></label><p className="notice">不同同学分别导入并命名，保留各自课程组合；重合上课班自动复用同一张卡片。不会用新导入的安排覆盖已有卡片。</p></>}
    {admin&&<div className="segmented small-segmented">{(['ai','excel','manual'] as const).map(s=><button type="button" className={mode===s?'active':''} key={s} disabled={busy} onClick={()=>{setMode(s);setPreview(null);setError('');}}>{s==='ai'?'外部 AI 结果':s==='excel'?'Excel 文件':'手动添加'}</button>)}</div>}
    {mode==='ai'&&<div className="ai-import-flow"><section className="ai-import-step"><div className="ai-step-heading"><span className="ai-step-number">1</span><div><h3>先交给豆包或其他 AI 整理</h3><p>复制提示词，再把学校“我的课程”整页文字一起发给 AI。</p></div></div><div className="ai-copy-instructions">打开学校的“<a href="https://yjsy.zju.edu.cn/dashboard/analysis" target="_blank" rel="noopener noreferrer" title="在新标签页打开研究生信息管理系统">研究生信息管理系统</a> → 我的课程”页面，在页面中按 <kbd>Ctrl+A</kbd> 全选，再按 <kbd>Ctrl+C</kbd> 复制，不用逐门选择课程。手机可以长按页面文字后全选复制。</div><button type="button" className="primary-button ai-flow-action" disabled={busy||promptBusy} onClick={()=>void copyPrompt()}><Copy size={17}/>{promptBusy?'正在准备提示词…':'点击这里复制提示词'}</button><details className="ai-full-prompt" onToggle={e=>{if(e.currentTarget.open)void viewPrompt();}}><summary>也可在这里查看完整提示词</summary>{promptBusy&&!prompt?<p>正在读取提示词…</p>:<textarea aria-label="完整课程整理提示词" readOnly rows={8} value={prompt}/>}</details>{copyMessage&&<p className="notice" role="status">{copyMessage}</p>}</section><section className="ai-import-step"><div className="ai-step-heading"><span className="ai-step-number">2</span><div><h3>把 AI 整理好的内容粘贴到这里</h3><p>完整复制从【课表开始】到【课表结束】的内容，回来查看课程安排。</p></div></div><label className="ai-result-label">AI 整理结果<textarea aria-label="AI 整理的课表内容" rows={8} placeholder="粘贴从【课表开始】到【课表结束】的全部内容" value={text} disabled={busy} onChange={e=>{setText(e.target.value);setPreview(null);setAccepted(false);setError('');}}/></label><button type="button" className="primary-button ai-flow-action" disabled={busy||!text.trim()} onClick={()=>void inspect()}>{busy?'正在生成安排…':preview?'重新查看安排':'查看安排'}</button><details className="ai-result-file"><summary>也可选择 AI 整理好的结果文件</summary><input type="file" aria-label="AI 整理结果文件" accept=".json,.txt,application/json,text/plain" disabled={busy} onChange={e=>void readJsonFile(e.target.files?.[0])}/></details></section><p className="muted-note">提示词会带上本学期的教学日历和作息。网站负责生成安排与校验，资料由你自行交给外部 AI 整理。</p></div>}
    {mode==='excel'&&<><label className="file-drop"><FileSpreadsheet size={28}/><strong>{admin?'选择一位同学本学期的 Excel 课表':'选择同一学期的 Excel 文件'}</strong><span>支持 .xls、.xlsx，每次最多 5 个、单个 2 MB</span><input type="file" accept=".xls,.xlsx" multiple onChange={e=>void readFiles(e.target.files)} disabled={busy}/></label>{files.map((f,i)=><p className="muted-note" key={i}>{f.name}</p>)}<p className="muted-note">{admin?'同一位同学的多个文件可合并为一份模板，不同同学请分别导入。':'不同学期请分别导入。'}“自定义周次”不会自动解释成每周上课。</p></>}
    {mode==='excel'&&<p className="muted-note">本次文件总大小不超过 6 MB。</p>}
    {mode==='excel'&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void inspect()}><Upload size={15}/>{busy?'正在检查…':'识别并预览'}</button>}
    {admin&&<p className="muted-note">模板中的课程会自动生成卡片。优先按同学期上课班编号去重；缺少班号时，仅在老师和完整上课安排一致时复用，信息不足会提示核对。</p>}
    {admin&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>setEditing({course:emptyCourse(),index:-1})}><Plus size={16}/>手动补充一门课程</button>}
    {preview&&<>{admin&&preview.stats&&<div className="notice">将新增 {preview.stats.newCourses} 门课程，复用 {preview.stats.reusedCourses} 门已有课程卡片。{preview.stats.reusedCourses>0&&'已有卡片的安排以本次预览为准，如需修改请到模板页的卡片中编辑。'}</div>}<div className="preview-heading"><strong>预览 {preview.courses.length} 门课程</strong><span>核对安排后再保存</span></div><div className="preview-course-list">{preview.courses.map((c,i)=><article key={i}><div><strong>{c.course_name}</strong><p>{c.teacher||'老师待确认'} · 班号 {c.teaching_class_code||'待确认'} · {c.sessions.length} 次已确定安排</p><span className={c.schedule_status==='ready'?'role-badge':'pending-status'}>{c.schedule_status==='ready'?'安排已明确':c.schedule_status==='pending'?'待安排':'需核对'}{admin?c.importAction==='reuse'?' · 复用已有卡片':' · 自动生成新卡片':c.matchedCourseId?' · 已匹配上课班':''}</span>{c.sessions.length>0&&<details className="ai-course-arrangements"><summary>查看全部 {c.sessions.length} 次上课安排</summary><ol>{c.sessions.map((session,j)=><li key={j}><time dateTime={session.date}>{session.date}</time> · {session.start_time}—{session.end_time} · {session.kind==='practice'?'实践活动，不在教室授课':session.room||'地点待通知'}</li>)}</ol></details>}</div><div className="row-actions">{(!admin||c.importAction!=='reuse')&&<button type="button" onClick={()=>setEditing({course:c,index:i})}>校对</button>}<button type="button" className="danger-text" disabled={busy} onClick={()=>void inspect(preview.courses.filter((_,j)=>j!==i))}>移除</button></div></article>)}</div><PreviewIssues preview={preview}/><label className="checkbox-line"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>我已核对上课班、日期及上述提示，确认保存；缺少时间的课程先留在待安排。</span></label></>}
    {error&&<p className="feedback" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>取消</button>{(mode!=='ai'||preview)&&<button type="button" className="primary-button compact" disabled={busy||!preview||!accepted||admin&&!templateName.trim()} onClick={()=>void save()}><Check size={16}/>{busy?'正在处理…':admin?'保存模板并生成卡片':'确认保存课表'}</button>}</div>
  </div></Modal>{editing&&<CourseEditor course={editing.course} term={term} busy={busy} onClose={()=>setEditing(null)} onSave={async c=>{const courses:CourseData[]=preview?.courses?[...preview.courses]:[];if(editing.index<0)courses.push(c);else courses[editing.index]=c;if(await inspect(courses))setEditing(null);}}/>}</>;
}
