import {acknowledgeHomework} from './useHomeworkUpdate';
import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,Circle} from 'lucide-react';
import {Modal} from '../components/Modal';
import {api,ApiError} from '../services/auth';
import {errorMessage} from '../timetable/types';
import {HomeworkCard} from './HomeworkCard';
import {homeworkChanged,type Homework} from './types';

export function HomeworkDetailDialog({recordId,onClose,closeLabel='返回我的作业'}:{recordId:string;onClose:()=>void;closeLabel?:string}){
  const [record,setRecord]=useState<Homework|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const active=useRef(false),mutationBusy=useRef(false),request=useRef(0);
  async function load(clearError=true){
    const token=++request.current;setLoading(true);if(clearError)setError('');
    try{const value=await api<Homework>('/homework/records/'+encodeURIComponent(recordId));if(active.current&&token===request.current){setRecord(value);if(value.hasUpdates){const read=await acknowledgeHomework(value);if(active.current&&token===request.current)setRecord(read);}}}
    catch(failure){if(active.current&&token===request.current)setError(errorMessage(failure));}
    finally{if(active.current&&token===request.current)setLoading(false);}
  }
  useEffect(()=>{
    active.current=true;setRecord(null);void load();
    return()=>{active.current=false;request.current++;};
  },[recordId]);
  async function setCompletion(completed:boolean){
    if(!record?.id||record.kind!=='assignment'||Boolean(record.completed)===completed||loading||mutationBusy.current)return;
    mutationBusy.current=true;setBusy(true);setError('');
    try{const value=await api<Homework>(`/homework/records/${record.id}/completion`,'POST',{completed,revision:record.revision});if(active.current){setRecord(value);homeworkChanged();}}
    catch(failure){if(active.current){setError(errorMessage(failure));if(failure instanceof ApiError&&failure.status===409){homeworkChanged();await load(false);}}}
    finally{mutationBusy.current=false;if(active.current)setBusy(false);}
  }
  return <Modal title="作业详情" onClose={onClose} busy={busy}><div className="homework-detail-dialog">{loading&&<p role="status">正在读取作业详情…</p>}{error&&<p className="feedback" role="alert">{error}</p>}{record?.kind==='assignment'&&<div className="homework-detail-completion"><span>完成状态</span><div className="segmented" role="group" aria-label="作业完成状态"><button type="button" className={!record.completed?'active':''} aria-pressed={!record.completed} disabled={busy||loading} onClick={()=>void setCompletion(false)}><Circle size={16}/>未完成</button><button type="button" className={record.completed?'active':''} aria-pressed={Boolean(record.completed)} disabled={busy||loading} onClick={()=>void setCompletion(true)}><CheckCircle2 size={16}/>已完成</button></div><p role="status">{busy?'正在保存完成状态…':record.completed?'已完成，不再显示于工作台待做列表。':'未完成，将按优先级和完成时间参与工作台排序。'}</p></div>}{record&&<HomeworkCard record={record} expandDetails/>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{closeLabel}</button></div></div></Modal>;
}
