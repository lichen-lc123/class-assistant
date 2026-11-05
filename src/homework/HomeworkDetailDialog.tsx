import {useEffect,useState} from 'react';
import {Modal} from '../components/Modal';
import {api} from '../services/auth';
import {errorMessage} from '../timetable/types';
import {HomeworkCard} from './HomeworkCard';
import type {Homework} from './types';

export function HomeworkDetailDialog({recordId,onClose,closeLabel='返回我的作业'}:{recordId:string;onClose:()=>void;closeLabel?:string}){
  const [record,setRecord]=useState<Homework|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    setRecord(null);setLoading(true);setError('');
    api<Homework>('/homework/records/'+encodeURIComponent(recordId)).then(value=>{if(active)setRecord(value);}).catch(failure=>{if(active)setError(errorMessage(failure));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[recordId]);
  return <Modal title="作业详情" onClose={onClose}><div className="homework-detail-dialog">{loading&&<p role="status">正在读取作业详情…</p>}{error&&<p className="feedback" role="alert">{error}</p>}{record&&<HomeworkCard record={record} expandDetails/>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>{closeLabel}</button></div></div></Modal>;
}
