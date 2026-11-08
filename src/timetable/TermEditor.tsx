import { useState, type FormEvent } from 'react';
import { api } from '../services/auth';
import { Modal } from '../components/Modal';
import { calendarKindNames } from '../../shared/academic-calendar.mjs';
import { AcademicCalendar } from './AcademicCalendar';
import { CalendarImport, type CalendarDraft } from './CalendarImport';
import { errorMessage, type Calendar, type CalendarEvent, type Period, type SchoolCalendar, type Term } from './types';

const emptySchool=():SchoolCalendar=>({title:'',institution:'',source_name:'',display_start:null,display_end:null,events:[],notes:[],warnings:[]});
export function TermEditor({term,onClose,onSaved}:{term:Term|null;onClose:()=>void;onSaved:(id:string)=>void}){
  const [year,setYear]=useState(term?.academicYear||''),[name,setName]=useState(term?.name||''),[start,setStart]=useState(term?.startsOn||''),[end,setEnd]=useState(term?.endsOn||'');
  const [calendars,setCalendars]=useState<Calendar[]>(term?.config.calendars||[]),[periods,setPeriods]=useState<Period[]>(term?.config.periods||[]);
  const [school,setSchool]=useState<SchoolCalendar|null>(term?.config.schoolCalendar||null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [manualOpen,setManualOpen]=useState(false),[imported,setImported]=useState(false),[importPending,setImportPending]=useState(false);
  const [sourceCalendars,setSourceCalendars]=useState<Calendar[]>(term?.config.sourceCalendars||[]);
  const config={calendars,sourceCalendars,periods,aliases:term?.config.aliases||[],...(school?{schoolCalendar:school}:{})};
  const draft:Term={id:term?.id||'preview',academicYear:year,name,startsOn:start||null,endsOn:end||null,revision:term?.revision||0,config};
  const missing=imported?[...(!start||!end?['学期开始和结束日期']:[]),...(!calendars.length?['教学周日历及起点']:[]),...(!periods.length?['完整节次作息']:[])]:[];
  const ready=Boolean(year&&name)&&!importPending&&!missing.length;
  function apply(value:CalendarDraft){
    const norm=(s:string)=>s.replace(/学期|学季|\s/g,'');
    if(term&&(term.academicYear!==value.academicYear||norm(term.name)!==norm(value.name)))throw new Error('识别结果与正在编辑的学年或学期不同。请校对结果，或退出后建立新学期，避免覆盖原配置。');
    setYear(value.academicYear);setName(term?.name||value.name);setStart(value.startsOn||'');setEnd(value.endsOn||'');setCalendars(value.config.calendars);setSourceCalendars(value.config.sourceCalendars||[]);setPeriods(value.config.periods);setSchool(value.config.schoolCalendar||null);setError('');setImported(true);setManualOpen(false);
  }
  async function save(e:FormEvent){e.preventDefault();if(!ready||busy)return;setBusy(true);setError('');try{const result=await api<Term>(term?`/admin/timetable/terms/${term.id}`:'/admin/timetable/terms',term?'PUT':'POST',{...draft,calendarConfirmed:true});onSaved(result.id);}catch(err){setError(errorMessage(err));}finally{setBusy(false);}}
  return <Modal title={term?'编辑学期与校历':'建立学期与校历'} onClose={onClose} busy={busy}><form onSubmit={save} className="manage-form wide-form calendar-editor">
    <CalendarImport onApply={apply} onPendingChange={setImportPending} target={term||undefined}/>
    {year&&name?<><div className="calendar-import-summary" role="region" aria-label="自动导入的学期信息"><strong>{imported?'全部字段已自动填入':'当前学期信息'}</strong><dl><div><dt>学校 / 学院</dt><dd>{school?.institution||'原图未注明'}</dd></div><div><dt>学年与学期</dt><dd>{year} · {name}</dd></div><div><dt>学期起止</dt><dd>{start||'待 AI 补充'} — {end||'待 AI 补充'}</dd></div><div><dt>教学周日历</dt><dd>统一按完整学期连续计算，不分段重置周次</dd></div><div><dt>节次作息</dt><dd>共 {periods.length} 节，含全部已识别时段</dd></div></dl></div><AcademicCalendar term={draft}/></>:<p className="calendar-await-result">粘贴 AI 返回结果后，这里会自动显示学期信息和完整校历核对表，无需手动填写下面的字段。</p>}
    {importPending&&<p className="muted-note" role="status">正在等待完整结果或解析更新，完成后即可核对保存。</p>}
    {missing.length>0&&<p className="feedback" role="alert">AI 结果缺少：{missing.join('、')}。请让 AI 对照原图补充完整后重新粘贴，不需要逐项手动选择。</p>}
    <details className="calendar-manual-fields" open={manualOpen} onToggle={e=>setManualOpen(e.currentTarget.open)}><summary>需要时手动修正字段（可选）</summary>{manualOpen&&<div className="calendar-manual-content">
    <div className="form-grid"><label>学年<input required placeholder="例如 2026-2027" value={year} onChange={e=>setYear(e.target.value)}/></label><label>学期名称<input required placeholder="按学校校历命名" value={name} onChange={e=>setName(e.target.value)}/></label><label>学期开始日期<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>学期结束日期<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
    <p className="muted-note">学期、教学周和作息仅由管理员维护，同学直接导入课表。校历的展示范围可以包含学期前后的假期，不等于学期起止范围。已有课程后不能直接改变学期归属名称。</p>
    <div className="mini-heading"><strong>教学周日历</strong><button type="button" className="text-button" disabled={calendars.length>0} onClick={()=>setCalendars([{name:'学期教学周',start_date:start,end_date:end||undefined}])}>设置学期教学周</button></div><p className="muted-note">整个学期只使用一个教学周起点，周次连续递增，后半学期不从第1周重新计数。</p>
    {calendars.map((c,i)=><div className="schedule-row" key={i}><label>周历名称<input required readOnly value={c.name} onChange={e=>setCalendars(calendars.map((v,j)=>i===j?{...v,name:e.target.value}:v))}/></label><label>第 1 周起点<input required type="date" value={c.start_date} onChange={e=>setCalendars(calendars.map((v,j)=>i===j?{...v,start_date:e.target.value}:v))}/></label><label>教学周结束日期<input type="date" value={c.end_date||''} onChange={e=>setCalendars(calendars.map((v,j)=>i===j?{...v,end_date:e.target.value||undefined}:v))}/></label><button type="button" className="text-button danger-text" onClick={()=>setCalendars(calendars.filter((_,j)=>i!==j))}>移除</button></div>)}
    <div className="mini-heading"><strong>完整节次作息</strong><button type="button" className="text-button" onClick={()=>setPeriods([...periods,{number:Math.max(0,...periods.map(p=>p.number))+1,start:'',end:'',section:''}])}>＋添加节次</button></div>
    {periods.map((p,i)=><div className="schedule-row" key={i}><label>时段<input placeholder="上午 / 下午 / 晚上" value={p.section||''} onChange={e=>setPeriods(periods.map((v,j)=>i===j?{...v,section:e.target.value}:v))}/></label><label>第几节<input type="number" min="1" max="30" required value={p.number} onChange={e=>setPeriods(periods.map((v,j)=>i===j?{...v,number:Number(e.target.value)}:v))}/></label><label>开始<input type="time" required value={p.start} onChange={e=>setPeriods(periods.map((v,j)=>i===j?{...v,start:e.target.value}:v))}/></label><label>结束<input type="time" required value={p.end} onChange={e=>setPeriods(periods.map((v,j)=>i===j?{...v,end:e.target.value}:v))}/></label><button type="button" className="text-button danger-text" onClick={()=>setPeriods(periods.filter((_,j)=>i!==j))}>移除</button></div>)}
    {school?<SchoolFields value={school} onChange={setSchool}/>:<button type="button" className="secondary-button" onClick={()=>setSchool(emptySchool())}>添加校历标题、假期与事项</button>}
    </div>}</details>
    {school&&<p className="muted-note">核对上方校历后，点击“确认无误并保存”即确认使用当前全部内容；无需逐项选择。待确认事项继续保留，不自动调整具体课程。</p>}
    {error&&<p className="feedback" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>取消</button><button className="primary-button compact" disabled={busy||!ready}>{busy?'正在保存…':'确认无误并保存'}</button></div>
  </form></Modal>;
}
function SchoolFields({value,onChange}:{value:SchoolCalendar;onChange:(v:SchoolCalendar)=>void}){
  const update=(patch:Partial<SchoolCalendar>)=>onChange({...value,...patch});
  const event=(index:number,patch:Partial<CalendarEvent>)=>update({events:value.events.map((e,i)=>i===index?{...e,...patch}:e)});
  return <div className="schedule-fields"><strong>校历资料</strong><div className="form-grid"><label>校历完整标题<input value={value.title} onChange={e=>update({title:e.target.value})}/></label><label>学校 / 学院<input value={value.institution} onChange={e=>update({institution:e.target.value})}/></label><label>校历展示开始日期<input type="date" value={value.display_start||''} onChange={e=>update({display_start:e.target.value||null})}/></label><label>校历展示结束日期<input type="date" value={value.display_end||''} onChange={e=>update({display_end:e.target.value||null})}/></label></div><label>来源说明<input value={value.source_name} onChange={e=>update({source_name:e.target.value})}/></label>
    <details><summary>编辑上课、考试、假期与其他事项（{value.events.length} 条）</summary><button type="button" className="text-button" onClick={()=>update({events:[...value.events,{title:'',kind:'event',start_date:'',end_date:null,description:''}]})}>＋添加事项</button>{value.events.map((e,i)=><fieldset key={i}><legend>事项 {i+1}</legend><div className="form-grid"><label>名称<input required value={e.title} onChange={x=>event(i,{title:x.target.value})}/></label><label>类型<select value={e.kind} onChange={x=>event(i,{kind:x.target.value as CalendarEvent['kind']})}>{Object.entries(calendarKindNames).map(([kind,name])=><option key={kind} value={kind}>{name}</option>)}</select></label><label>开始日期<input type="date" required value={e.start_date} onChange={x=>event(i,{start_date:x.target.value})}/></label><label>结束日期（单日可留空）<input type="date" value={e.end_date||''} onChange={x=>event(i,{end_date:x.target.value||null})}/></label></div><label>原文或适用范围<textarea rows={2} value={e.description} onChange={x=>event(i,{description:x.target.value})}/></label><button type="button" className="text-button danger-text" onClick={()=>update({events:value.events.filter((_,j)=>j!==i)})}>移除事项</button></fieldset>)}</details>
    <label>原文备注（一行一项）<textarea rows={3} value={value.notes.join('\n')} onChange={e=>update({notes:e.target.value.split('\n')})}/></label><label>待确认问题（一行一项，核实后可修改）<textarea rows={3} value={value.warnings.join('\n')} onChange={e=>update({warnings:e.target.value.split('\n')})}/></label>
  </div>;
}
