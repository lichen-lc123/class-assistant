import {useEffect,useState} from 'react';
import {CalendarDays,ClipboardCheck,House,UserRound,LogOut,ArrowLeft} from 'lucide-react';
import type {User} from '../services/auth';
import {DashboardPage} from '../timetable/DashboardPage';
import {TimetablePage} from '../timetable/TimetablePage';
import {HomeworkPage} from '../homework/HomeworkPage';
import {AccountSettings} from '../pages/AccountSettings';
import {HomeworkMenuBadge} from '../homework/HomeworkMenuBadge';
import {CourseHomeworkHost} from '../homework/CourseHomeworkDialog';
import {CourseMaintenancePrompt} from '../timetable/CourseMaintenancePrompt';
import {HomeworkCompletionDialog,readCompletionIntent} from '../homework/HomeworkCompletionDialog';

// Independent phone navigation and page composition; APIs and domain rules are shared.
export function MobileWorkspace({user,onUpdated,onLogout}:{user:User;onUpdated:(user:User)=>void;onLogout:()=>Promise<void>}){
  const [tab,setTab]=useState('home'),[manage,setManage]=useState(false),[prompt,setPrompt]=useState(true),[error,setError]=useState('');
  const [intent,setIntent]=useState(()=>readCompletionIntent(window.location.search));
  const current=user.mustChangePassword?'account':tab;
  const pages=[['home','首页',House],['homework','作业',ClipboardCheck],['calendar','课表',CalendarDays],['account','我的',UserRound]] as const;
  useEffect(()=>{window.scrollTo(0,0);document.title=`${pages.find(p=>p[0]===current)?.[1]} · MEM2602`;},[current,manage]);
  function closeIntent(){setIntent(null);const url=new URL(location.href);url.searchParams.delete('completeHomework');url.searchParams.delete('homeworkRevision');history.replaceState(null,'',url.pathname+url.search+url.hash);window.dispatchEvent(new Event('homework-updated'));}
  return <div className="workspace mobile-layout mobile-app"><header className="phone-header"><div>{manage&&current==='calendar'?<button className="icon-button" aria-label="返回课表" onClick={()=>setManage(false)}><ArrowLeft/></button>:null}<h1>{current==='home'?`${user.name}，你好`:current==='calendar'&&manage?'添加课程':pages.find(p=>p[0]===current)?.[1]}</h1></div>{current==='home'&&<span>把今天安排好</span>}</header>
    <main className="workspace-main">{error&&<p className="feedback" role="alert">{error}</p>}
      {current==='home'?<DashboardPage onManage={()=>{setTab('calendar');setManage(true);}} onHomework={()=>setTab('homework')}/>:current==='homework'?<HomeworkPage/>:current==='calendar'?<TimetablePage key={String(manage)} manage={manage} onManage={()=>setManage(!manage)}/>:<><AccountSettings user={user} onUpdated={onUpdated}/><button className="secondary-button mobile-logout" onClick={()=>void onLogout().catch(e=>setError(e.message))}><LogOut size={18}/>退出登录</button></>}
    </main><nav className="phone-navigation" aria-label="手机主导航">{pages.map(([key,label,Icon])=><button type="button" key={key} disabled={user.mustChangePassword&&key!=='account'} aria-current={current===key?'page':undefined} onClick={()=>{setTab(key);setManage(false);}}><Icon size={22}/><span>{label}</span>{key==='homework'&&!user.mustChangePassword&&<HomeworkMenuBadge/>}</button>)}</nav>
    <CourseHomeworkHost/>{prompt&&!user.mustChangePassword&&!intent&&<CourseMaintenancePrompt onClose={()=>setPrompt(false)} onManage={()=>{setPrompt(false);setTab('calendar');setManage(true);}}/>}{intent&&!user.mustChangePassword&&<HomeworkCompletionDialog intent={intent} onClose={closeIntent}/>}</div>;
}
