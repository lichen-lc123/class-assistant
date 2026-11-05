import {useState,type FormEvent} from 'react';
import {Modal} from '../components/Modal';
import {errorMessage,type Term} from '../timetable/types';
import {HomeworkCard} from './HomeworkCard';
import {HomeworkCourseSelect} from './HomeworkCourseSelect';
import type {Homework,HomeworkAsset,HomeworkTarget} from './types';
export function HomeworkEditor({record,term,classes,assets=[],onSave,onClose}:{record:Homework;term:Term;classes:HomeworkTarget[];assets?:HomeworkAsset[];onSave:(r:Homework)=>Promise<void>;onClose:()=>void}){
  const [r,setR]=useState<Homework>({...record,targetKeys:record.targetKeys||record.targets?.map(t=>t.key)||[]}),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const patch=(value:Partial<Homework>)=>setR(old=>({...old,...value}));
  const options=[...classes,...(r.targetKeys||[]).filter(k=>!classes.some(c=>c.key===k)).map(key=>({key,classCode:key.slice(5),courseId:null,label:'上课班 '+key.slice(5)}))];
  async function save(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await onSave(r);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <Modal title={record.id?'编辑作业与考核':'核对作业与考核'} onClose={onClose} busy={busy}><form className="manage-form homework-editor" onSubmit={save}>
    <p className="muted-note">{term.academicYear} · {term.name}</p>
    <label>类型<select value={r.kind} onChange={e=>patch({kind:e.target.value as Homework['kind']})}><option value="assignment">待做作业</option><option value="reference">课程考核与说明</option></select></label>
    <HomeworkCourseSelect value={r.course_name} classes={classes} selectedKeys={r.targetKeys||[]} disabled={busy} onType={value=>patch({course_name:value,...(value!==r.course_name?{targetKeys:[],published:false}:{})})} onSelect={course=>patch({course_name:course.courseName||'',teacher:course.teacher||'',targetKeys:[course.key]})}/>
    <label>任课老师<input required maxLength={100} value={r.teacher} onChange={e=>patch({teacher:e.target.value})}/></label><label>标题<input required maxLength={160} value={r.title} onChange={e=>patch({title:e.target.value})}/></label>
    <div className="homework-date-fields"><label>序号（可选）<input maxLength={30} value={r.sequence||''} onChange={e=>patch({sequence:e.target.value})}/></label><label>学分（可选）<input maxLength={30} value={r.credits||''} onChange={e=>patch({credits:e.target.value})}/></label></div>
    {([['content','作业内容'],['submission','提交平台 / 提交方式'],['assessment_rules','课程考核规则'],['team_requirement','组队要求'],['notes','备注']] as const).map(([key,label])=><label key={key}>{label}<textarea rows={key==='content'||key==='assessment_rules'?4:2} value={r[key]} onChange={e=>patch({[key]:e.target.value})}/></label>)}
    {r.kind==='assignment'&&<><div className="homework-date-fields"><label>截止日期<input type="date" value={r.due_date||''} onChange={e=>patch({due_date:e.target.value||null,...(!e.target.value?{due_time:null}:{})})}/></label><label>具体时间（可不填）<input type="time" disabled={!r.due_date} value={r.due_time||''} onChange={e=>patch({due_time:e.target.value||null})}/></label></div><label>原始截止说明<textarea rows={2} value={r.deadline_raw} onChange={e=>patch({deadline_raw:e.target.value})}/></label></>}
    {!!r.attachments.length&&<details><summary>核对原表图片</summary><HomeworkCard record={r} assets={assets}/></details>}
    <fieldset className="homework-targets"><legend>适用上课班（可多选）</legend><p className="muted-note">作业跟随上课班。不同老师的内容请分别确认；不会按课程名称向所有同学发布。</p>{options.map(c=><label className="checkbox-line" key={c.key}><input type="checkbox" checked={r.targetKeys?.includes(c.key)||false} onChange={e=>patch({targetKeys:e.target.checked?[...(r.targetKeys||[]),c.key]:r.targetKeys?.filter(k=>k!==c.key)})}/><span>{c.label||c.key}</span></label>)}<div className="homework-manual-class"><input aria-label="准确的上课班编号" placeholder="也可填写准确的上课班编号" value={code} onChange={e=>setCode(e.target.value)}/><button type="button" className="secondary-button" disabled={!code.trim()} onClick={()=>{if(!/^[A-Za-z0-9_-]{1,60}$/.test(code.trim())){setError('班号仅支持字母、数字、下划线和短横线。');return;}patch({targetKeys:[...new Set([...(r.targetKeys||[]),'code:'+code.trim()])]});setCode('');}}>添加班号</button></div></fieldset>
    <label className="checkbox-line"><input type="checkbox" checked={r.published} disabled={!r.targetKeys?.length&&!r.published} onChange={e=>patch({published:e.target.checked})}/><span>发布给已选上课班的同学<small>尚未确认班级时请保存为草稿。</small></span></label>
    {!!r.warnings.length&&<details><summary>导入核对提示</summary><ul>{r.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}{error&&<p className="feedback" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button compact" disabled={busy}>{busy?'保存中…':'保存'}</button></div>
  </form></Modal>;
}
