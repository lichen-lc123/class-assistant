import {useEffect,useRef,useState} from 'react';
import {CheckCircle2} from 'lucide-react';
import {Modal} from '../components/Modal';
import {api,ApiError} from '../services/auth';
import {errorMessage} from '../timetable/types';
import {HomeworkCard} from './HomeworkCard';
import {homeworkChanged,type Homework} from './types';

export interface CompletionIntent {id:string;revision:number}
export function readCompletionIntent(search:string):CompletionIntent|null{
  const q=new URLSearchParams(search),id=q.get('completeHomework'),revision=Number(q.get('homeworkRevision'));
  return id&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)&&Number.isSafeInteger(revision)&&revision>0?{id,revision}:null;
}
export function HomeworkCompletionDialog({intent,onClose}:{intent:CompletionIntent;onClose:()=>void}){
  const [record,setRecord]=useState<Homework|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const active=useRef(true);
  async function load(){setLoading(true);setError('');try{const value=await api<Homework>('/homework/records/'+encodeURIComponent(intent.id));if(active.current)setRecord(value);}catch(e){if(active.current)setError(errorMessage(e));}finally{if(active.current)setLoading(false);}}
  useEffect(()=>{active.current=true;void load();return()=>{active.current=false;};},[intent.id]);
  async function complete(){if(!record||busy)return;setBusy(true);setError('');try{const value=await api<Homework>(`/homework/records/${record.id}/completion`,'POST',{completed:true,revision:record.revision});if(active.current){setRecord(value);homeworkChanged();}}catch(e){if(active.current){setError(errorMessage(e));if(e instanceof ApiError&&e.status===409)void load();}}finally{if(active.current)setBusy(false);}}
  return <Modal title="完成作业" onClose={onClose} busy={busy}><div className="manage-form homework-completion-dialog">{loading&&<p role="status">正在读取作业最新状态…</p>}{record&&<>{record.completed?<div className="homework-completion-success" role="status"><CheckCircle2 size={30}/><strong>已完成</strong><p>当前版本的作业已移出待做列表，不再列入后续作业提醒。</p></div>:<><p>确认完成后，将同步到你的账号，并停止此作业当前版本的后续提醒。</p>{record.revision!==intent.revision&&<p className="notice">这条提醒发出后，作业内容已更新。请核对下面的最新内容，再确认完成。</p>}</>}<HomeworkCard record={record}/></>}{error&&<p className="feedback" role="alert">{error}</p>}<p className="muted-note">手机消息发送尚未接通；此入口用于统一处理页面和后续手机提醒的完成操作。</p><div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{record?.completed?'返回我的作业':'暂不完成'}</button>{record&&!record.completed&&<button type="button" className="primary-button compact" disabled={busy||loading} onClick={()=>void complete()}><CheckCircle2 size={17}/>{busy?'正在保存…':'完成并停止提醒'}</button>}</div></div></Modal>;
}
