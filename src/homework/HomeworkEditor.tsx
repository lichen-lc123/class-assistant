import {useState,type FormEvent} from 'react';
import {Modal} from '../components/Modal';
import {errorMessage,type Term} from '../timetable/types';
import {HomeworkCard} from './HomeworkCard';
import {HomeworkAttachmentsEditor} from './HomeworkAttachmentsEditor';
import {HomeworkCourseSelect} from './HomeworkCourseSelect';
import type {Homework,HomeworkAsset,HomeworkTarget} from './types';
export function HomeworkEditor({record,term,classes,assets=[],onSave,onClose}:{record:Homework;term:Term;classes:HomeworkTarget[];assets?:HomeworkAsset[];onSave:(r:Homework,assets:HomeworkAsset[])=>Promise<void>;onClose:()=>void}){
  const [r,setR]=useState<Homework>({...record,targetKeys:record.targetKeys||record.targets?.map(t=>t.key)||[]}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [uploadAssets,setUploadAssets]=useState<HomeworkAsset[]>(assets),[uploading,setUploading]=useState(false);
  const working=busy||uploading;
  const patch=(value:Partial<Homework>)=>setR(old=>({...old,...value}));
  async function save(e:FormEvent){e.preventDefault();if(working)return;setBusy(true);setError('');try{if(r.targetKeys?.length!==1)throw new Error('请在课程名称中选择一门课程，保存后会自动发布给该课程的同学。');await onSave({...r,published:true,autoPublish:true},uploadAssets);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <Modal title={record.id?'编辑作业与考核':'核对作业与考核'} onClose={onClose} busy={working}><form className="manage-form homework-editor" onSubmit={save}>
    <p className="muted-note">{term.academicYear} · {term.name}</p>
    <label>类型<select value={r.kind} onChange={e=>patch({kind:e.target.value as Homework['kind']})}><option value="assignment">待做作业</option><option value="reference">课程考核与说明</option></select></label>
    <HomeworkCourseSelect value={r.course_name} classes={classes} selectedKeys={r.targetKeys||[]} disabled={working} onType={value=>patch({course_name:value,...(value!==r.course_name?{targetKeys:[],published:false}:{})})} onSelect={course=>patch({course_name:course.courseName||'',teacher:course.teacher||'',targetKeys:[course.key]})}/>
    <label>任课老师<input readOnly value={r.teacher} placeholder="选择课程后自动填写"/></label><label>标题<input required maxLength={160} value={r.title} onChange={e=>patch({title:e.target.value})}/></label>
    <div className="homework-date-fields"><label>序号（可选）<input maxLength={30} value={r.sequence||''} onChange={e=>patch({sequence:e.target.value})}/></label><label>学分（可选）<input maxLength={30} value={r.credits||''} onChange={e=>patch({credits:e.target.value})}/></label></div>
    {([['content','作业内容'],['submission','提交平台 / 提交方式'],['assessment_rules','课程考核规则'],['team_requirement','组队要求'],['notes','备注']] as const).map(([key,label])=><label key={key}>{label}<textarea rows={key==='content'||key==='assessment_rules'?4:2} value={r[key]} onChange={e=>patch({[key]:e.target.value})}/></label>)}
    <HomeworkAttachmentsEditor attachments={r.attachments} assets={uploadAssets} disabled={working} onProcessing={setUploading} onChange={(attachments,files)=>{patch({attachments});setUploadAssets(files);}}/>
    {r.kind==='assignment'&&<><div className="homework-date-fields"><label>截止日期<input type="date" value={r.due_date||''} onChange={e=>patch({due_date:e.target.value||null,...(!e.target.value?{due_time:null}:{})})}/></label><label>具体时间（可不填）<input type="time" disabled={!r.due_date} value={r.due_time||''} onChange={e=>patch({due_time:e.target.value||null})}/></label></div></>}
    {!!r.attachments.length&&<details><summary>核对图片与附件</summary><HomeworkCard record={r} assets={uploadAssets}/></details>}
    {error&&<p className="feedback" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary-button" type="button" disabled={working} onClick={onClose}>取消</button><button className="primary-button compact" disabled={working}>{busy?'保存中…':'保存'}</button></div>
  </form></Modal>;
}
