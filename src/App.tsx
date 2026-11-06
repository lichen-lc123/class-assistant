import {MobileWorkspace} from './mobile/MobileWorkspace';
import {HomeworkMenuBadge} from './homework/HomeworkMenuBadge';
import { useMobileLayout } from './components/useMobileLayout';
import { CourseHomeworkHost } from './homework/CourseHomeworkDialog';
import { useEffect, useState } from 'react';
import { BookOpen, CalendarDays, ClipboardCheck, LayoutDashboard, FileSpreadsheet, LogOut, Settings, UserRound } from 'lucide-react';
import { api, type User } from './services/auth';
import { LoginPage } from './pages/LoginPage';
import { AccountSettings } from './pages/AccountSettings';
import { UserManagement } from './pages/UserManagement';
import { TimetablePage } from './timetable/TimetablePage';
import { AdminTimetable } from './timetable/AdminTimetable';
import { DashboardPage } from './timetable/DashboardPage';
import { CourseMaintenancePrompt } from './timetable/CourseMaintenancePrompt';
import { HomeworkPage } from './homework/HomeworkPage';
import { ReminderSettingsPage } from './reminders/ReminderSettings';
import { HomeworkCompletionDialog,readCompletionIntent } from './homework/HomeworkCompletionDialog';
export function App() {
  const mobile=useMobileLayout();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'dashboard' | 'timetable' | 'timetableManage' | 'users' | 'courseAdmin' | 'homework' | 'homeworkAdmin' | 'reminders' | 'account'>('dashboard');
  const [completionIntent,setCompletionIntent]=useState(()=>readCompletionIntent(window.location.search));
  const [workspace, setWorkspace] = useState<'personal' | 'admin'>('personal');
  const [error, setError] = useState('');
  const [homeworkDetailId,setHomeworkDetailId]=useState<string|null>(null);
  const [showCoursePrompt,setShowCoursePrompt]=useState(true);
  useEffect(() => {
    let active = true;
    api<User>('/auth/me').then((value) => { if (active) setUser(value); }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    const expire = () => { setUser(null); setError(''); };
    const refresh = () => { void api<User>('/auth/me').then((value) => { if (active) setUser(value); }).catch(() => {}); };
    window.addEventListener('session-expired', expire);
    window.addEventListener('account-updated', refresh);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('session-expired', expire); window.removeEventListener('account-updated', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [user?.id, tab]);
  const titles = { reminders:'提醒设置',homework:'我的作业',homeworkAdmin:'作业管理',dashboard:'工作台',timetableManage:'课表管理',timetable:'我的课表',users:'账号管理',courseAdmin:'课程管理',account:'我的账号' };
  const adminWorkspace = user?.role==='admin' && !user.mustChangePassword && workspace==='admin' && !mobile;
  const activeTab = user?.mustChangePassword ? 'account' : adminWorkspace ? (tab==='reminders'||tab==='homework'||tab==='timetable'||tab==='dashboard'||tab==='timetableManage'?'courseAdmin':tab) : (tab==='homeworkAdmin'||tab==='courseAdmin'||tab==='users'?'dashboard':tab);
  useEffect(() => { document.title = user ? `${titles[activeTab]} · 作业提醒` : '学号登录 · 作业提醒'; }, [user, activeTab]);
  useEffect(()=>{if(user&&!user.mustChangePassword&&completionIntent){setWorkspace('personal');setTab('homework');}},[user?.id,user?.mustChangePassword,completionIntent]);
  function closeCompletion(){setCompletionIntent(null);const url=new URL(window.location.href);url.searchParams.delete('completeHomework');url.searchParams.delete('homeworkRevision');window.history.replaceState(null,'',url.pathname+url.search+url.hash);window.dispatchEvent(new Event('homework-updated'));}
  async function logout() {
    try { await api('/auth/logout', 'POST'); setUser(null); setWorkspace('personal'); setTab('dashboard'); setHomeworkDetailId(null); setShowCoursePrompt(true); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '退出失败。'); }
  }
  if (loading) return <main className="loading-screen">正在加载…</main>;
  if (!user) return <LoginPage onAuthenticated={(value) => { setUser(value); setWorkspace('personal'); setTab('dashboard'); setHomeworkDetailId(null); setShowCoursePrompt(true); }} />;
  if(mobile)return <MobileWorkspace key={user.id} user={user} onUpdated={setUser} onLogout={logout}/>;
  const allowedAdmin = user.role === 'admin' && !user.mustChangePassword && !mobile;
  return <div className={`workspace ${mobile?'mobile-layout':''}`}><aside className="workspace-sidebar"><div className="workspace-brand"><span className="brand-icon"><ClipboardCheck size={24} /></span><strong>作业提醒</strong></div>
    {allowedAdmin&&<div className="workspace-mode-switch" role="group" aria-label="切换个人中心与管理工作台"><button type="button" aria-pressed={!adminWorkspace} className={!adminWorkspace?'active':''} onClick={()=>{setWorkspace('personal');setTab('dashboard');}}>个人中心</button><button type="button" aria-pressed={adminWorkspace} className={adminWorkspace?'active':''} onClick={()=>{setWorkspace('admin');setTab('courseAdmin');}}>管理工作台</button></div>}
    <nav aria-label="主导航">{!adminWorkspace&&!user.mustChangePassword&&<><button className={activeTab==='dashboard'?'active':''} onClick={()=>setTab('dashboard')}><LayoutDashboard size={19}/>工作台</button><button className={activeTab==='homework'?'active':''} onClick={()=>setTab('homework')}><ClipboardCheck size={19}/>我的作业<HomeworkMenuBadge key={user.id}/></button><button className={activeTab==='timetable'||mobile&&activeTab==='timetableManage'?'active':''} onClick={()=>setTab('timetable')}><CalendarDays size={19}/>我的课表</button>{!mobile&&<button className={activeTab==='timetableManage'?'active':''} onClick={()=>setTab('timetableManage')}><FileSpreadsheet size={19}/>课表管理</button>}</>}{adminWorkspace&&<><button className={activeTab==='homeworkAdmin'?'active':''} onClick={()=>setTab('homeworkAdmin')}><ClipboardCheck size={19}/>作业管理</button><button className={activeTab==='courseAdmin'?'active':''} onClick={()=>setTab('courseAdmin')}><BookOpen size={19}/>课程管理</button><button className={activeTab==='users'?'active':''} onClick={()=>setTab('users')}><Settings size={19}/>账号管理</button></>}<button className={activeTab==='account'?'active':''} onClick={()=>setTab('account')}><UserRound size={19}/>我的账号</button></nav>
    <div className="sidebar-footer"><div className="sidebar-profile"><span className="avatar small-avatar">{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><p>{user.studentId}</p></div></div><button type="button" className="secondary-button logout-button" onClick={()=>void logout()}><LogOut size={16}/>退出登录</button></div></aside>
    <main className="workspace-main">{mobile&&<header className="mobile-page-heading"><strong>{titles[activeTab]}</strong><span>{user.name}</span></header>}<h1 className="workspace-page-title">{titles[activeTab]}</h1>
    {error && <p role="alert" className="feedback">{error}</p>}{activeTab==='reminders'&&!adminWorkspace?<ReminderSettingsPage key={user.id+'reminders'} user={user}/>:activeTab==='homework'&&!adminWorkspace?<HomeworkPage key={user.id+'homework'} detailId={homeworkDetailId} onCloseDetail={()=>setHomeworkDetailId(null)}/>:activeTab==='homeworkAdmin'&&adminWorkspace?<HomeworkPage key={user.id+'homeworkAdmin'} admin/>:activeTab==='dashboard'&&!adminWorkspace?<DashboardPage key={user.id} onHomework={id=>{setHomeworkDetailId(id||null);setTab('homework');}} onManage={()=>setTab('timetableManage')}/>:activeTab==='timetable'&&!adminWorkspace?<TimetablePage key={user.id+':view'} onManage={()=>setTab('timetableManage')}/>:activeTab==='timetableManage'&&!adminWorkspace?<TimetablePage key={user.id+':manage'} manage onManage={()=>setTab('timetable')}/>:activeTab==='courseAdmin'&&allowedAdmin?<AdminTimetable/>:activeTab==='users'&&allowedAdmin?<UserManagement currentUser={user}/>:<AccountSettings user={user} onUpdated={setUser}/>}{mobile&&activeTab==='account'&&<button type="button" className="secondary-button mobile-logout" onClick={()=>void logout()}><LogOut size={16}/>退出登录</button>}</main><CourseHomeworkHost key={user.id}/>{showCoursePrompt&&!user.mustChangePassword&&!adminWorkspace&&!completionIntent&&<CourseMaintenancePrompt onClose={()=>setShowCoursePrompt(false)} onManage={()=>{setShowCoursePrompt(false);setWorkspace('personal');setTab('timetableManage');}}/>}{completionIntent&&!user.mustChangePassword&&<HomeworkCompletionDialog key={user.id+':'+completionIntent.id} intent={completionIntent} onClose={closeCompletion}/>}</div>;
}
