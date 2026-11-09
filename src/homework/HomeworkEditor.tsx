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
  async function save(e:FormEvent){e.preventDefault();if(working)return;setBusy(true);setError('');try{if(record.published&&!r.targetKeys?.length)throw new Error('请选择适用课程后保存已发布作业。');await onSave({...r,published:record.published,autoPublish:false,auto_publish_on_match:!r.targetKeys?.length&&r.auto_publish_on_match===true},uploadAssets);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <Modal title={record.id?'编辑作业与考核':'核对作业与考核'} onClose={onClose} busy={working}><form className="manage-form homework-editor" onSubmit={save}>
    <p className="muted-note">{term.academicYear} · {term.name}</p><p className="muted-note">{record.published?'保存只更新已发布内容。':r.auto_publish_on_match&&!r.targetKeys?.length?'保存后等待课程补齐；未明确上课时间时适用同名同老师的全部课程，明确时间时按时间核对。':'保存后仍为草稿，回到卡片点击“发布”才会发给同学。'}</p>
    {!record.published&&!r.targetKeys?.length&&<label className="checkbox-line"><input type="checkbox" checked={r.auto_publish_on_match===true} onChange={e=>patch({auto_publish_on_match:e.target.checked})}/><span>课程补齐后自动匹配并发布</span></label>}
    <label>类型<select value={r.kind} onChange={e=>patch({kind:e.target.value as Homework['kind']})}><option value="assignment">待做作业</option><option value="reference">课程考核与说明</option></select></label>
    {record.review_required&&<><p className="notice">{record.review_reasons?.join('；')||'请核对原表内容并补全课程信息。'}</p><label className="checkbox-line"><input type="checkbox" checked={!r.review_required} onChange={e=>patch({review_required:!e.target.checked})}/><span>我已核对并补全待确认内容</span></label></>}
    {r.course_time&&<p className="muted-note">原表上课时间：{r.course_time}</p>}
    <HomeworkCourseSelect multiple value={r.course_name} classes={classes} selectedKeys={r.targetKeys||[]} disabled={working} onType={value=>patch({course_name:value,...(value!==r.course_name?{targetKeys:[],audience_mode:'selected' as const}:{})})} onSelect={course=>{const keys=r.targetKeys||[],next=keys.includes(course.key)?keys.filter(k=>k!==course.key):[...keys,course.key],first=classes.find(c=>c.key===next[0]);patch({course_name:first?.courseName||r.course_name,teacher:first?.teacher||r.teacher,targetKeys:next,audience_mode:'selected',auto_publish_on_match:false});}}/>
    <label>任课老师<input readOnly value={r.teacher} placeholder="选择课程后自动填写"/></label><label>标题<input required maxLength={160} value={r.title} onChange={e=>patch({title:e.target.value})}/></label>
    <div className="homework-date-fields"><label>序号（可选）<input maxLength={30} value={r.sequence||''} onChange={e=>patch({sequence:e.target.value})}/></label><label>学分（可选）<input maxLength={30} value={r.credits||''} onChange={e=>patch({credits:e.target.value})}/></label></div>
    {([['content','作业内容'],['submission','提交平台 / 提交方式'],['assessment_rules','课程考核规则'],['team_requirement','组队要求'],['notes','备注']] as const).map(([key,label])=><label key={key}>{label}<textarea rows={key==='content'||key==='assessment_rules'?4:2} value={r[key]} onChange={e=>patch({[key]:e.target.value})}/></label>)}
    <HomeworkAttachmentsEditor attachments={r.attachments} assets={uploadAssets} disabled={working} onProcessing={setUploading} onChange={(attachments,files)=>{patch({attachments});setUploadAssets(files);}}/>
    {r.kind==='assignment'&&<><div className="homework-date-fields"><label>截止日期<input type="date" value={r.due_date||''} onChange={e=>patch({due_date:e.target.value||null,...(!e.target.value?{due_time:null}:{})})}/></label><label>具体时间（可不填）<input type="time" disabled={!r.due_date} value={r.due_time||''} onChange={e=>patch({due_time:e.target.value||null})}/></label></div></>}
    {!!r.attachments.length&&<details><summary>核对图片与附件</summary><HomeworkCard record={r} assets={uploadAssets}/></details>}
    {error&&<p className="feedback" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary-button" type="button" disabled={working} onClick={onClose}>取消</button><button className="primary-button compact" disabled={working}>{busy?'保存中…':'保存'}</button></div>
  </form></Modal>;
}
