import {useRef,useState} from 'react';
import {api} from '../services/auth';
import {homeworkChanged,type Homework} from './types';
export async function acknowledgeHomework(record:Homework){
  if(!record.id||!record.hasUpdates)return record;
  const updated=await api<Homework>(`/homework/records/${record.id}/read`,'POST',{revision:record.revision});
  homeworkChanged();return updated;
}
export function useHomeworkUpdate(record:Homework,enabled=true){
  const [seen,setSeen]=useState<number|null>(null),[error,setError]=useState('');
  const busy=useRef(false);
  const unread=enabled&&Boolean(record.hasUpdates)&&seen!==record.revision;
  async function acknowledge(){
    if(!unread||busy.current)return;
    busy.current=true;setError('');
    try{await acknowledgeHomework(record);setSeen(record.revision!);}
    catch(e){setError(e instanceof Error?e.message:'未能保存已读状态，请重试。');homeworkChanged();}
    finally{busy.current=false;}
  }
  return{unread,error,acknowledge};
}
