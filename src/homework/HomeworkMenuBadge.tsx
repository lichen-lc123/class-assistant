import {useEffect,useState} from 'react';
import {api} from '../services/auth';
import type {HomeworkSummary} from './types';
export function HomeworkMenuBadge(){
  const [count,setCount]=useState(0);
  useEffect(()=>{let active=true,request=0;const refresh=async()=>{const token=++request;try{const result=await api<HomeworkSummary>('/homework/summary');if(active&&token===request)setCount(result.pendingCount);}catch{}};
    void refresh();const update=()=>void refresh();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')update();},30000);
    window.addEventListener('homework-updated',update);window.addEventListener('timetable-updated',update);window.addEventListener('focus',update);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('homework-updated',update);window.removeEventListener('timetable-updated',update);window.removeEventListener('focus',update);};
  },[]);
  return count>0?<span className="homework-menu-badge" aria-label={`${count} 项待完成作业`}>{count}</span>:null;
}
