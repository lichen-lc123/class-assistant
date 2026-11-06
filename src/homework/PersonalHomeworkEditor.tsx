import {useEffect,useState,type FormEvent} from 'react';
import {Modal} from '../components/Modal';
import {api} from '../services/auth';
import {errorMessage,type Term,type TimetableView} from '../timetable/types';
import {emptyHomework,type Homework,type HomeworkTarget,type HomeworkAsset} from './types';
import {HomeworkAttachmentsEditor} from './HomeworkAttachmentsEditor';
import {HomeworkCourseSelect} from './HomeworkCourseSelect';
import {weekdayLabel} from '../timetable/date';
export function PersonalHomeworkEditor({record,terms,initialTermId,onClose,onSaved}:{record:Homework|null;terms:Term[];initialTermId:string;onClose:()=>void;onSaved:(termId:string)=>void}){
  const [r,setR]=useState<Homework>(record||emptyHomework()),[termId,setTermId]=useState(record?.termId||initialTermId||terms[0]?.id||''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [courses,setCourses]=useState<HomeworkTarget[]>([]),[courseEntryId,setCourseEntryId]=useState(record?.course_entry_id||''),[loadingCourses,setLoadingCourses]=useState(false);
  const [uploadAssets,setUploadAssets]=useState<HomeworkAsset[]>([]),[uploading,setUploading]=useState(false);
  const working=busy||loadingCourses||uploading;
  const patch=(value:Partial<Homework>)=>setR(old=>({...old,...value}));
  useEffect(()=>{
    let active=true;setCourses([]);
    if(!termId){setLoadingCourses(false);return()=>{active=false;};}
    setLoadingCourses(true);setError('');
    api<TimetableView>(`/timetable/${encodeURIComponent(termId)}`).then(data=>{
      if(!active)return;
      const options=data.courses.map(course=>({key:course.id,courseId:course.publicCourseId||null,courseName:course.course_name,teacher:course.teacher||'',timeLabel:course.sessions.length?`${course.sessions[0].date} 起 · ${[...new Set(course.sessions.map(s=>`${weekdayLabel(s.date)} ${s.start_time}—${s.end_time}`))].join('、')}`:'上课时间待安排'}));
      setCourses(options);
      if(record&&record.termId===termId){
        const exact=options.find(course=>course.key===record.course_entry_id);
        const legacy=options.filter(course=>course.courseName===record.course_name&&course.teacher===record.teacher);
        const chosen=exact||(!record.course_entry_id&&legacy.length===1?legacy[0]:null);
        if(chosen){setCourseEntryId(chosen.key);patch({course_name:chosen.courseName||'',teacher:chosen.teacher||''});}
      }
    }).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setLoadingCourses(false);});
    return()=>{active=false;};
  },[termId,record?.id]);
  const keepingPrevious=Boolean(record&&courseEntryId===(record.course_entry_id||'')&&r.course_name===record.course_name&&r.teacher===record.teacher);

  async function save(e:FormEvent){e.preventDefault();if(working)return;if(!courseEntryId&&!keepingPrevious){setError('请从下拉列表选择自己课表中的课程。');return;}setBusy(true);setError('');try{await api(record?'/homework/personal/'+record.id:'/homework/personal',record?'PUT':'POST',{termId,record:{...r,course_entry_id:courseEntryId||null,kind:'assignment',targetKeys:[]},assets:uploadAssets,revision:record?.revision});onSaved(termId);onClose();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <Modal title={record?'编辑个人作业':'新增个人作业'} onClose={onClose} busy={busy||uploading}><form className="manage-form" onSubmit={save}><p className="notice">仅自己可见，会一起参与工作台待做作业排序。</p><label>所属学期<select required disabled={busy||Boolean(record)} value={termId} onChange={e=>{setTermId(e.target.value);setCourseEntryId('');patch({course_name:'',teacher:''});}}><option value="">请选择已配置学期</option>{terms.map(t=><option key={t.id} value={t.id}>{t.academicYear} · {t.name}</option>)}</select></label><label>作业标题<input required maxLength={160} value={r.title} onChange={e=>patch({title:e.target.value})} disabled={busy} placeholder="例如：完成本周阅读报告"/></label><HomeworkCourseSelect personal required={!record||Boolean(record.course_name)} value={r.course_name} classes={courses} selectedKeys={courseEntryId?[courseEntryId]:[]} disabled={working||!termId} onType={value=>{setCourseEntryId('');patch({course_name:value,teacher:''});}} onSelect={course=>{setCourseEntryId(course.key);patch({course_name:course.courseName||'',teacher:course.teacher||''});setError('');}}/>{loadingCourses&&<p className="muted-note" role="status">正在读取你的课表课程…</p>}{!loadingCourses&&termId&&!courses.length&&<p className="notice">本学期课表中还没有课程，请先到“课表管理”添加课程。</p>}{record&&keepingPrevious&&!courses.some(course=>course.key===courseEntryId)&&<p className="muted-note">原作业资料会保留；更换课程时，只能选择当前自己的课表课程。</p>}<label>任课老师<input readOnly value={r.teacher} disabled={busy} placeholder={courseEntryId?'老师待确认':'选择课程后自动填写'}/></label><HomeworkAttachmentsEditor attachments={r.attachments} assets={uploadAssets} disabled={working} onProcessing={setUploading} onChange={(attachments,files)=>{patch({attachments});setUploadAssets(files);}}/><label>作业内容（可选）<textarea rows={4} maxLength={20000} value={r.content} onChange={e=>patch({content:e.target.value})} disabled={busy}/></label><div className="homework-date-fields"><label>截止日期（可选）<input type="date" value={r.due_date||''} disabled={busy} onChange={e=>patch({due_date:e.target.value||null,...(!e.target.value?{due_time:null}:{})})}/></label><label>具体时间（可选）<input type="time" value={r.due_time||''} disabled={busy||!r.due_date} onChange={e=>patch({due_time:e.target.value||null})}/></label></div><label>提交平台 / 提交方式（可选）<textarea rows={2} maxLength={4000} value={r.submission} onChange={e=>patch({submission:e.target.value})} disabled={busy}/></label><label>备注（可选）<textarea rows={2} maxLength={20000} value={r.notes} onChange={e=>patch({notes:e.target.value})} disabled={busy}/></label><p className="muted-note">保存后可以通过“我的安排”调整优先级和计划完成时间。</p>{error&&<p className="feedback" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button compact" disabled={working||!termId||(!record&&!courses.length)}>{busy?'保存中…':'保存个人作业'}</button></div></form></Modal>;
}
