import {MobileLessonCarousel} from '../mobile/MobileLessonCarousel';
import { useMobileLayout } from '../components/useMobileLayout';
import { openCourseHomework } from '../homework/CourseHomeworkDialog';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {CalendarDays,Globe,ClipboardList,ChevronLeft,ChevronRight,Pause,Play,ExternalLink,type LucideIcon} from 'lucide-react';
import {api,ApiError} from '../services/auth';
import {humanDate} from './date';
import {SessionTile} from './CalendarContent';
import {errorMessage,type DashboardView,type DashboardDay} from './types';
import {homeworkChanged,type Homework,type HomeworkSummary} from '../homework/types';
import {DashboardHomeworkCard} from '../homework/DashboardHomeworkCard';
import {HomeworkDetailDialog} from '../homework/HomeworkDetailDialog';

export function DashboardColumnHeading({icon:Icon,title,children,className=''}:{icon:LucideIcon;title:string;children?:ReactNode;className?:string}){
  return <div className={`dashboard-column-heading ${className}`}><div><Icon size={22} aria-hidden="true"/><h2>{title}</h2></div>{children}</div>;
}
export function DashboardEmptyState({title,description,actionLabel,onAction}:{title:string;description:string;actionLabel?:string;onAction?:()=>void}){
  return <div className="dashboard-empty dashboard-section-empty"><h3>{title}</h3><p>{description}</p>{actionLabel&&onAction&&<button type="button" className="primary-button compact" onClick={onAction}>{actionLabel}</button>}</div>;
}
export function DashboardDayCards({days,now=Date.now()}:{days:DashboardDay[];now?:number}){
  const [activeDate,setActiveDate]=useState(days[0]?.date||'');
  const [playing,setPlaying]=useState(()=>typeof window==='undefined'||!window.matchMedia('(prefers-reduced-motion: reduce)').matches),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false);
  const touch=useRef<{x:number;y:number}|null>(null),index=Math.max(0,days.findIndex(day=>day.date===activeDate)),dateKey=days.map(day=>day.date).join('|');
  function move(step:number){if(days.length)setActiveDate(days[(index+step+days.length)%days.length].date);}
  useEffect(()=>{if(days.length<2||!playing||hovered||focused)return;const timer=window.setInterval(()=>{if(document.visibilityState==='visible')setActiveDate(days[(index+1)%days.length].date);},4000);return()=>clearInterval(timer);},[dateKey,index,playing,hovered,focused]);
  return <div className="dashboard-classes" role="region" aria-roledescription="轮播" aria-label={days.length===1?'上课日安排':'未来三个上课日'} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={e=>setFocused(e.target.matches(':focus-visible'))} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false);}}>
    <DashboardColumnHeading icon={CalendarDays} title="上课安排">{days.length>1&&<div className="class-carousel-controls"><button type="button" aria-label="上一个上课日" title="上一个上课日" onClick={()=>move(-1)}><ChevronLeft size={18}/></button><button type="button" aria-label={playing?'暂停自动切换':'开启自动切换'} title={playing?'暂停自动切换':'开启自动切换'} aria-pressed={playing} onClick={()=>{setPlaying(value=>!value);setFocused(false);}}>{playing?<Pause size={15}/>:<Play size={15}/>}</button><button type="button" aria-label="下一个上课日" title="下一个上课日" onClick={()=>move(1)}><ChevronRight size={18}/></button></div>}</DashboardColumnHeading>
    <div className="class-carousel-window" onTouchCancel={()=>{touch.current=null;}} onTouchStart={e=>{const point=e.touches[0];touch.current=point?{x:point.clientX,y:point.clientY}:null;}} onTouchEnd={e=>{const point=e.changedTouches[0],start=touch.current;touch.current=null;if(point&&start){const dx=point.clientX-start.x,dy=point.clientY-start.y;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.3)move(dx<0?1:-1);}}}>
      <div className="class-carousel-track" style={{transform:`translateX(-${index*100}%)`}}>{days.map((day,i)=><section className={`upcoming-day-card upcoming-day-${i} class-carousel-slide`} key={day.date} aria-label={humanDate(day.date)} aria-hidden={i!==index} inert={i!==index}><header className="upcoming-day-heading"><div><span>{day.daysUntil===0?'今天':days.length===1?'下一个上课日':`第 ${i+1} 个上课日`}</span><h2>{humanDate(day.date)}</h2></div><div className="class-countdown"><span>距离上课</span><strong>{day.daysUntil}<small>天</small></strong></div></header><div className="upcoming-lessons">{day.lessons.map((lesson,j)=><div key={lesson.entryId+lesson.start+j}><SessionTile item={lesson} now={now} inlineDetails onCourse={openCourseHomework}/></div>)}</div></section>)}</div>
    </div>
    {days.length>1&&<div className="class-carousel-footer"><div className="class-carousel-dots">{days.map((day,i)=><button type="button" key={day.date} aria-label={`查看${humanDate(day.date)}的课程`} aria-current={index===i?'true':undefined} className={index===i?'active':''} onClick={()=>setActiveDate(day.date)}/>)}</div><span>{index+1} / {days.length}</span></div>}
  </div>;
}
export function DashboardPage({onManage,onHomework}:{onManage:()=>void;onHomework:(id?:string)=>void}){
  const mobile=useMobileLayout();
  const [homework,setHomework]=useState<HomeworkSummary|null>(null),[homeworkError,setHomeworkError]=useState('');
  const [detailId,setDetailId]=useState<string|null>(null);
  const [completingId,setCompletingId]=useState<string|null>(null),[completionError,setCompletionError]=useState('');
  const homeworkRequest=useRef(0),homeworkActive=useRef(false),completionBusy=useRef(false);
  async function refreshHomework(){const token=++homeworkRequest.current;try{const value=await api<HomeworkSummary>('/homework/summary');if(homeworkActive.current&&token===homeworkRequest.current){setHomework(value);setHomeworkError('');}}catch(e){if(homeworkActive.current&&token===homeworkRequest.current)setHomeworkError(errorMessage(e));}}
  async function completeHomework(record:Homework){
    if(!record.id||completionBusy.current)return;
    completionBusy.current=true;setCompletingId(record.id);setCompletionError('');
    try{
      const saved=await api<Homework>(`/homework/records/${record.id}/completion`,'POST',{completed:true,revision:record.revision});
      if(!homeworkActive.current)return;
      if(!saved.completed)throw new Error('完成状态未保存，请刷新后重试。');
      homeworkRequest.current++;
      setHomework(value=>{const previous=value?.records.find(item=>item.id===record.id);return value&&previous?{...value,records:value.records.filter(item=>item.id!==record.id),pendingCount:Math.max(0,value.pendingCount-1),overdueCount:Math.max(0,value.overdueCount-(previous.overdue?1:0))}:value;});
      homeworkChanged();
    }catch(e){if(homeworkActive.current){setCompletionError(errorMessage(e));if(e instanceof ApiError&&e.status===409)homeworkChanged();}}
    finally{completionBusy.current=false;if(homeworkActive.current)setCompletingId(null);}
  }
  useEffect(()=>{homeworkActive.current=true;const refresh=()=>void refreshHomework();refresh();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')refresh();},30000);window.addEventListener('focus',refresh);window.addEventListener('homework-updated',refresh);return()=>{homeworkActive.current=false;homeworkRequest.current++;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('homework-updated',refresh);};},[]);
  const [data,setData]=useState<DashboardView|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const request=useRef(0);
  async function load(quiet=false){const token=++request.current;if(!quiet){setLoading(true);setError('');}try{const result=await api<DashboardView>('/timetable/dashboard'+(mobile?'?view=mobile':''));if(token===request.current){setData(result);}}catch(e){if(token===request.current&&!quiet)setError(errorMessage(e));}finally{if(token===request.current)setLoading(false);}}
  useEffect(()=>{void load();const refresh=()=>void load();window.addEventListener('focus',refresh);window.addEventListener('timetable-updated',refresh);window.addEventListener('timetable-terms-changed',refresh);const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load(true);},30000);return()=>{request.current++;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('timetable-updated',refresh);window.removeEventListener('timetable-terms-changed',refresh);};},[mobile]);
  return <div className="personal-dashboard"><div className="dashboard-topbar"><DashboardClock/></div>
    <div className="dashboard-columns"><section className="workspace-card dashboard-course-column">
    {!data?.days.length&&<DashboardColumnHeading icon={CalendarDays} title="上课安排"/>}
    {error&&<p className="feedback" role="alert">{error}</p>}
    {loading&&!data?<p className="dashboard-section-loading" role="status">正在整理后续上课安排…</p>:data?.days.length?<><>{mobile?<MobileLessonCarousel day={data.days[0]} onExhausted={()=>void load(true)}/>:<DashboardDayCards days={data.days}/>}</>{!mobile&&data.days.length<3&&<p className="muted-note">当前只找到 {data.days.length} 个后续上课日，已展示全部已确定安排。</p>}</>:!error&&<DashboardEmptyState title={data?.timetableCount?'暂无后续已确定的上课安排':'先添加本学期课程'} description={data?.timetableCount?'时间待确认的课程不会排进具体日期，可到课表管理中补充。':mobile?'添加课程后，这里会显示今天或下一个上课日的课程。':'添加课程后，这里会显示未来三个上课日的课程和倒计时。'} actionLabel={data?.timetableCount?'管理我的课表':'添加课程'} onAction={onManage}/>}
    {!!data?.pendingCourseCount&&<p className="notice">有 {data.pendingCourseCount} 门课程时间待确认，暂未计入上课日。</p>}
    </section>
    <section className="workspace-card dashboard-homework"><DashboardColumnHeading icon={ClipboardList} title="待做作业" className="dashboard-homework-heading">{homework&&<span className="dashboard-homework-summary" role="status">{homework.pendingCount} 项待完成{homework.overdueCount?` · ${homework.overdueCount} 项已逾期`:``}</span>}</DashboardColumnHeading>{homeworkError&&<p className="feedback" role="alert">{homeworkError}</p>}{!homework&&!homeworkError&&<p className="muted-note">正在读取作业…</p>}{completionError&&<p className="feedback" role="alert">{completionError}</p>}<div className="dashboard-homework-list">{homework?.records.slice(0,mobile?2:4).map(r=><DashboardHomeworkCard key={r.id} record={r} onOpen={setDetailId} onComplete={record=>void completeHomework(record)} disabled={completingId!==null} completing={completingId===r.id}/>)}</div>{homework?.pendingCount===0&&!homeworkError&&<DashboardEmptyState title="暂无待做作业" description="已完成的作业仍可在“我的作业”中查看，也可以在那里添加个人作业。"/>}<div className="dashboard-homework-footer">{<button className="secondary-button" onClick={()=>onHomework()}>查看全部作业</button>}</div></section>{!mobile&&<section className="workspace-card dashboard-websites"><DashboardColumnHeading icon={Globe} title="常用网址"/><a className="dashboard-website-link" href="https://yjsy.zju.edu.cn/dashboard/analysis" target="_blank" rel="noopener noreferrer"><span><strong>研究生信息管理系统</strong><small>登录后查看学校“我的课程”</small></span><ExternalLink size={17}/></a></section>}</div>
    {detailId&&<HomeworkDetailDialog key={detailId} recordId={detailId} onClose={()=>setDetailId(null)} closeLabel="关闭详情"/>}
  </div>;
}

const clockDate=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',weekday:'long'});
const clockTime=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function DashboardClock(){
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const update=()=>setNow(new Date());const timer=window.setInterval(update,1000);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};},[]);
  return <div className="dashboard-current-time" aria-label="当前北京时间"><time dateTime={now.toISOString()}><span>{clockDate.format(now)}</span><strong>{clockTime.format(now)}</strong></time><span>北京时间</span></div>;
}
