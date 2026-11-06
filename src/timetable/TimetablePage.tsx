import { useMobileLayout } from '../components/useMobileLayout';
import { MobileWeekCalendar } from './MobileWeekCalendar';
import { openCourseHomework } from '../homework/CourseHomeworkDialog';
import { CalendarContent, classroomText, lessonText, type DisplaySession } from './CalendarContent';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Layers3, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../services/auth';
import { Modal } from '../components/Modal';
import { ImportDialog } from './ImportDialog';
import { SelectionDialog } from './SelectionDialog';
import { SessionsEditor } from './CourseEditor';
import { CourseWeekdays } from './CourseWeekdays';
import { bounds, humanDate, moveReference, shiftDate, today, weekdayLabel } from './date';
import { errorMessage, sourceNames, type Course, type ExplicitSession, type Source, type TermList, type TimetableView } from './types';

type ImportSource=Exclude<Source,'excel'>;
type Action={kind:'delete'}|{kind:'remove'|'override';course:Course};
export function TimetablePage({manage=false,onManage}:{manage?:boolean;onManage?:()=>void}){
  const mobile=useMobileLayout();
  const [termList,setTermList]=useState<TermList|null>(null),[termId,setTermId]=useState(''),[data,setData]=useState<TimetableView|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [view,setView]=useState(mobile?'week':'month'),[reference,setReference]=useState(today()),[automatic,setAutomatic]=useState(true),[now,setNow]=useState(Date.now());
  const [entry,setEntry]=useState<ImportSource|null>(null),[action,setAction]=useState<Action|null>(null);
  useEffect(()=>setView(mobile?'week':'month'),[mobile]);
  const modalOpen=useRef(false);modalOpen.current=Boolean(entry||action);
  const request=useRef(0),automaticRef=useRef(automatic),termRef=useRef(termId);automaticRef.current=automatic;termRef.current=termId;
  async function loadTerms(){try{const r=await api<TermList>('/timetable/terms');setTermList(r);if(automaticRef.current){setTermId(r.currentTermIds.length===1?r.currentTermIds[0]:'');setReference(r.today);}else if(termRef.current&&!r.terms.some(t=>t.id===termRef.current))setTermId('');}catch(e){setError(errorMessage(e));}finally{setLoading(false);}}
  async function loadTable(quiet=false){const id=termRef.current;if(!id)return;const token=++request.current;if(!quiet){setLoading(true);setError('');}try{const result=await api<TimetableView>(`/timetable/${id}`);if(token===request.current&&id===termRef.current)setData(result);}catch(e){if(token===request.current&&!quiet)setError(errorMessage(e));}finally{if(token===request.current)setLoading(false);}}
  useEffect(()=>{void loadTerms();const focus=()=>{void loadTerms();void loadTable();};window.addEventListener('focus',focus);window.addEventListener('timetable-updated',focus);window.addEventListener('timetable-terms-changed',focus);const timer=window.setInterval(()=>{setNow(Date.now());if(document.visibilityState==='visible'&&!modalOpen.current)void loadTable(true);},30000);return()=>{clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('timetable-updated',focus);window.removeEventListener('timetable-terms-changed',focus);};},[]);
  useEffect(()=>{request.current++;setData(null);setEntry(null);setAction(null);if(termId)void loadTable();else setLoading(false);},[termId]);
  const currentDate=today();
  useEffect(()=>{if(automatic){setReference(currentDate);void loadTerms();}},[currentDate,automatic]);
  const term=termList?.terms.find(t=>t.id===termId);
  const table=data?.term.id===termId?data:null;
  const all:DisplaySession[]=(table?.courses||[]).flatMap((c,index)=>c.sessions.map((s,lessonIndex)=>({...s,lessonNumber:s.lesson_number??lessonIndex+1,entryId:c.id,courseName:c.course_name,teacher:c.teacher||null,index}))).sort((a,b)=>a.start.localeCompare(b.start));
  const courseStarts=[term?.startsOn,...all.map(s=>s.date)].filter((date):date is string=>Boolean(date)).sort();
  const courseEnds=[term?.endsOn,...all.map(s=>s.end.slice(0,10))].filter((date):date is string=>Boolean(date)).sort();
  const [rangeStart,rangeEnd]=bounds(view,reference,courseStarts[0],courseEnds.at(-1));
  const teachingWeeks=(term?.config.calendars||[]).map(calendar=>{
    const anchorDay=new Date(calendar.start_date+'T00:00:00Z').getUTCDay()||7;
    const monday=shiftDate(calendar.start_date,1-anchorDay);
    const week=Math.floor((Date.parse(reference+'T00:00:00Z')-Date.parse(monday+'T00:00:00Z'))/604800000)+1;
    return week>0&&(!calendar.end_date||reference<=calendar.end_date)?`${calendar.name}：第 ${week} 教学周`:null;
  }).filter(Boolean);
  const visible=all.filter(s=>(!rangeStart||Date.parse(s.end)>Date.parse(rangeStart+'T00:00:00+08:00'))&&(!rangeEnd||Date.parse(s.start)<Date.parse(rangeEnd+'T00:00:00+08:00')));
  function manualDate(date:string){if(!date)return;setAutomatic(false);setReference(date);}
  function backToday(){setAutomatic(true);setReference(currentDate);void loadTerms();}
  function saved(message='课表已保存。'){setNotice(message);void loadTable();}
  const periodName=view==='week'?'周':view==='month'?'月':'天';
  const icons={ai:Sparkles,template:Layers3,cards:CalendarDays};
  const entryTitles:Record<ImportSource,string>={ai:'AI 整理导入',template:'使用模板',cards:'课程卡片组合'};
  return <div className="personal-timetable">{mobile&&onManage&&<button type="button" className="secondary-button mobile-course-manage" onClick={onManage}>{manage?'返回课表':'添加 / 管理课程'}</button>}<div className="timetable-toolbar"><div className="term-context"><span>{termList?.currentTermIds.includes(termId)?'当前学期':'查看学期'}</span><strong>{term?`${term.academicYear} · ${term.name}`:loading?'正在读取学期…':'等待管理员设置'}</strong></div><button className="secondary-button" onClick={backToday}>{manage?'返回当前学期':'回到今天'}</button><button className="icon-button" aria-label="刷新课表" onClick={()=>{void loadTerms();void loadTable();}}><RefreshCw size={17}/></button></div>
    {!!termList?.terms.some(t=>t.id!==termId)&&<details className="term-history"><summary>查看其他学期</summary><label className="term-selector">查看管理员已设置的学期<select aria-label="查看其他学期" value={termId} onChange={e=>{const t=termList.terms.find(t=>t.id===e.target.value);setAutomatic(false);setTermId(e.target.value);setReference(t?.startsOn&&!(t.startsOn<=currentDate&&t.endsOn!>=currentDate)?t.startsOn:currentDate);setNotice('');}}><option value="">请选择要查看的学期</option>{termList.terms.map(t=><option value={t.id} key={t.id}>{t.academicYear} · {t.name}{termList.currentTermIds.includes(t.id)?'（当前）':''}</option>)}</select></label></details>}
    {error&&<p className="feedback" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
    {!term&&<section className="workspace-card setup-empty"><CalendarDays size={34}/><h2>{loading?'正在读取当前学期…':'当前学期待管理员设置'}</h2><p>{loading?'正在读取管理员设置的学期。':termList?.currentTermIds.length?'当前学期日期存在重叠，请联系管理员检查。':'学期和教学作息由管理员统一维护，无需同学填写。管理员完成当前学期设置后，即可直接导入课表。'}</p></section>}
    {term&&<>

      {manage&&!loading&&table&&<section className="workspace-card source-panel"><div className="source-panel-heading"><h2>{table.timetable?'新增课程':'导入本学期课表'}</h2><span className="source-choice-notice">3 种方式</span></div><p>支持多次使用以下方式添加课程。每次导入会检查时间，课程时段重复时不能导入。</p><div className="source-options">{(['ai','template','cards'] as ImportSource[]).map((s,index)=>{const Icon=icons[s];return <button key={s} onClick={()=>{setAutomatic(false);setEntry(s);}}><div className="source-option-heading"><div className="source-option-identity"><span className="source-number" aria-label={'方式 '+(index+1)}>{index+1}</span><Icon size={24}/></div>{s==='ai'?<span className="source-category self-import">自行导入</span>:<span className="source-category source-recommended">推荐</span>}</div><strong>{entryTitles[s]}</strong><span>{s==='ai'?'复制学校整页课程交给 AI 整理，再粘贴结果查看安排':s==='template'?'选用准备好的整套课表，一次加入全部课程':'从预设课程卡片中，挑选并组合自己的课表'}</span></button>;})}</div></section>}
      {manage&&table?.timetable&&<><div className="personal-source-bar"><span className="role-badge">首次导入：{sourceNames[table.timetable.source]}</span><div><button className="text-button danger-text" onClick={()=>setAction({kind:'delete'})}><Trash2 size={15}/>清空本学期课表</button></div></div>
</>}
        {!manage&&<section className="workspace-card calendar-panel"><div className="calendar-navigation"><div className="segmented" role="group" aria-label="课表视图">{[['day','日视图'],['week','周视图'],['month','月视图'],['term','学期']].map(([key,label])=><button type="button" key={key} aria-pressed={view===key} className={view===key?'active':''} onClick={()=>setView(key)}>{label}</button>)}</div><div className="date-navigation"><button className="icon-button" disabled={view==='term'} aria-label={'上一'+periodName} title={'上一'+periodName} onClick={()=>manualDate(moveReference(view,reference,-1))}><ChevronLeft size={18}/></button><input type="date" aria-label="查看日期" value={reference} onChange={e=>manualDate(e.target.value)}/><button className="icon-button" disabled={view==='term'} aria-label={'下一'+periodName} title={'下一'+periodName} onClick={()=>manualDate(moveReference(view,reference,1))}><ChevronRight size={18}/></button></div></div>
          <p className="view-caption">{view==='term'?`${term.academicYear} · ${term.name}`:view==='week'?`${rangeStart} 至 ${rangeEnd?shiftDate(rangeEnd,-1):''} · 自然周（周一至周日）`:view==='month'?reference.slice(0,7):humanDate(reference)}{!automatic&&' · 手动浏览'}</p>
          {view!=='term'&&teachingWeeks.length>0&&<p className="muted-note">所选日期 · {teachingWeeks.join('；')}</p>}
          {table?.timetable&&<p className="calendar-range-summary">{view==='day'?'当天':view==='week'?'本周':view==='month'?'本月':'本学期'}共 {visible.length} 次课{view==='week'?(mobile?' · 点击日期查看当天课程':' · 左右滑动可查看整周'):''}{view==='month'?' · 左右滑动查看月历，点击日期查看详情':''}</p>}
          {loading?<p className="empty-state">正在加载课表…</p>:table?.timetable?(mobile&&view==='week'?<MobileWeekCalendar date={reference} items={visible} onCourse={openCourseHomework}/>:<CalendarContent view={view} date={reference} items={visible} now={now} onCourse={openCourseHomework} onDate={date=>{manualDate(date);setView('day');}}/>):<div className="empty-state"><CalendarDays size={28}/><p>导入课表后，即可按日、周、月查看课程。</p><small>请在“课表管理”中选择一种方式导入。</small></div>}
        </section>}
      {manage&&table?.timetable&&<>
        {table.conflicts.length>0&&<details className="review-issues conflict-box"><summary>{table.conflicts.length} 处课程时间冲突</summary><ul>{table.conflicts.map((c,i)=><li key={i}>{c.date}：{c.first} / {c.second}</li>)}</ul></details>}
        <section className="workspace-card my-courses-panel"><div className="section-heading"><div><h2>我的课程 <span className="subtle-text">{table.courses.length} 门</span></h2><p>个人修改只影响本人，未修改部分跟随公共安排。</p></div></div><div className="my-course-list">{table.courses.map(c=><article key={c.id}><div><CourseOverview course={c} now={now}/><div className="tile-badges">{!c.sessions.length&&<span className="pending-status">待安排</span>}{c.hasOverride&&<span className="role-badge">个人安排优先</span>}{c.publicChanged&&<span className="pending-status">{c.hasOverride?'课程已更新，个人安排仍优先':'已同步管理员更新'}</span>}</div>{!!c.notices?.length&&<details className="course-warnings schedule-notices"><summary>排课说明</summary><ul>{c.notices.map((note,i)=><li key={i}>{note}</li>)}</ul></details>}{c.warnings.length>0&&<details className="course-warnings"><summary>{c.warnings.length} 条待确认信息</summary><ul>{c.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}</div><div className="row-actions"><button onClick={()=>setAction({kind:'override',course:c})}>调整个人安排</button><button className="danger-text" onClick={()=>setAction({kind:'remove',course:c})}>移除</button></div></article>)}</div>{!table.courses.length&&<p className="empty-state">当前课表没有课程，可使用上方任意方式添加。</p>}</section>
      </>}
    </>}
    {entry&&term&&(entry==='ai'?<ImportDialog term={term} source={entry} current={table} onClose={()=>setEntry(null)} onSaved={saved}/>:<SelectionDialog term={term} source={entry} current={table} onClose={()=>setEntry(null)} onSaved={()=>saved()}/>)}
    {action&&term&&table&&<PersonalAction action={action} data={table} onClose={()=>setAction(null)} onSaved={message=>{setAction(null);saved(message);}}/>}
  </div>;
}
function CourseOverview({course,now}:{course:Course;now:number}){
  const lesson=course.sessions.find(s=>Date.parse(s.end)>now)||course.sessions.at(-1);
  const label=lesson?lessonText({...lesson,lessonNumber:course.sessions.indexOf(lesson)+1}):'课次待确认';
  return <><h3><button type="button" className="course-name-link" onClick={()=>openCourseHomework(course.id)}>{course.course_name}</button></h3><CourseWeekdays sessions={course.sessions}/>{lesson?<><p className="overview-course-time">{lesson.date} · {weekdayLabel(lesson.date)} · {lesson.start_time}—{lesson.end_time}</p><p className="overview-course-room">{classroomText(lesson)}</p></>:<p className="overview-course-room">时间及教室待安排</p>}<p className="overview-course-secondary">{label} · {course.teacher||'老师待确认'}</p><p className="overview-course-secondary">共 {course.sessions.length} 次已确定安排</p></>;
}
function PersonalAction({action,data,onClose,onSaved}:{action:Action;data:TimetableView;onClose:()=>void;onSaved:(message:string)=>void}){
  const course=action.kind==='delete'?null:action.course;
  const [sessions,setSessions]=useState<ExplicitSession[]>(()=>course?.sessions.map(s=>({date:s.date,start_time:s.start_time,end_time:s.end_time,room:s.room,kind:s.kind==='practice'?'practice':'lecture'}))||[]);
  const [pending,setPending]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(reset=false){setBusy(true);setError('');try{const base=`/timetable/${data.term.id}`;if(action.kind==='delete')await api(base,'DELETE',{revision:data.timetable!.revision,confirm:true});else if(action.kind==='remove')await api(`${base}/entries/${course!.id}`,'DELETE',{revision:data.timetable!.revision});else if(reset)await api(`${base}/entries/${course!.id}/reset`,'POST',{revision:data.timetable!.revision});else await api(`${base}/entries/${course!.id}`,'PATCH',{revision:data.timetable!.revision,publicRevision:course!.publicRevision,sessions,markPending:pending});onSaved(action.kind==='delete'?'本学期个人课表已清空，可重新导入课程。':action.kind==='remove'?'已从个人课表移除，公共课程未删除。':reset?'已恢复默认安排。':'个人安排已保存，仅影响本人。');}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <Modal title={action.kind==='delete'?'删除本学期课表':action.kind==='remove'?'移除个人课程':'调整个人上课安排'} onClose={onClose} busy={busy}><div className={`manage-form ${action.kind==='override'?'wide-form':''}`}><p>{action.kind==='delete'?`${data.term.academicYear} · ${data.term.name}`:course?.course_name}</p>{action.kind==='delete'?<p className="delete-warning">将删除本学期的个人选课及个人修改，不能撤销。公共课程、模板、其他学期和账号保留。以后仍可重新导入课程。</p>:action.kind==='remove'?<p className="delete-warning">只从本人课表移除该课程，不会删除管理员的公共课程或其他人的课表。</p>:<><p className="muted-note">这里的日期和时间只对你生效，引用课程保持不变。仅修改地点不会冻结公共时间；改动日期或起止时间后，个人时间安排优先。请核对全部课次。</p><SessionsEditor value={sessions} onChange={setSessions}/>{!sessions.length&&<label className="checkbox-line"><input type="checkbox" checked={pending} onChange={e=>setPending(e.target.checked)}/><span>明确设为待安排，暂不排入具体日期</span></label>}{course?.hasOverride&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void submit(true)}>清除个人调整，恢复{course.publicCourseId?'公共':'导入'}安排</button>}</>}{error&&<p className="feedback" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="button" className={`primary-button compact ${action.kind!=='override'?'danger-button':''}`} disabled={busy||(action.kind==='override'&&!sessions.length&&!pending)} onClick={()=>void submit()}>{busy?'正在保存…':action.kind==='override'?'保存个人安排':'确认删除'}</button></div></div></Modal>;
}
