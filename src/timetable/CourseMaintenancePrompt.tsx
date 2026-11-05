import {useEffect,useState} from 'react';
import {CalendarDays} from 'lucide-react';
import {Modal} from '../components/Modal';
import {api} from '../services/auth';
import type {TermList,TimetableView} from './types';

export function CourseMaintenancePrompt({onClose,onManage}:{onClose:()=>void;onManage:()=>void}){
  const [eligible,setEligible]=useState(false);
  useEffect(()=>{
    let active=true;
    async function check(){
      try{
        const terms=await api<TermList>('/timetable/terms');
        if(!active)return;
        if(terms.currentTermIds.length!==1){onClose();return;}
        const timetable=await api<TimetableView>('/timetable/'+encodeURIComponent(terms.currentTermIds[0]));
        if(!active)return;
        if(timetable.courses.length){onClose();return;}
        setEligible(true);
      }catch{if(active)onClose();}
    }
    void check();return()=>{active=false;};
  },[]);
  if(!eligible)return null;
  return <Modal title="添加本学期课程" onClose={onClose}><div className="course-maintenance-prompt"><span className="course-prompt-icon"><CalendarDays size={30}/></span><p className="course-prompt-title">先添加一下本学期的课程吧</p><p>你还没有添加本学期课程。可以自行导入课表，也可以选择模板或课程卡片，系统会根据你的选择展示上课安排和课程作业。</p><p className="muted-note">这一步可以跳过，稍后随时在“课表管理”中添加。</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>暂时跳过</button><button type="button" className="primary-button compact" onClick={onManage}>去添加课程</button></div></div></Modal>;
}
