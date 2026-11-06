import {useEffect,useRef,useState} from 'react';
import {Bell,CalendarClock,Check,ClipboardList,Cloud,RefreshCw,Smartphone} from 'lucide-react';
import {api,ApiError,type User} from '../services/auth';
import {errorMessage} from '../timetable/types';
import {reminderPayload,type ReminderPreferences,type ReminderSettings} from './types';

function ReminderSwitch({label,checked,disabled,onChange}:{label:string;checked:boolean;disabled:boolean;onChange:(value:boolean)=>void}){
  return <button type="button" className="reminder-switch" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={()=>onChange(!checked)}><span/></button>;
}
function LeadOptions({label,options,value,disabled,onChange}:{label:string;options:[number,string][];value:number;disabled:boolean;onChange:(value:number)=>void}){
  return <div className="reminder-lead-options" role="group" aria-label={label}>{options.map(([minutes,title])=><button type="button" key={minutes} aria-pressed={value===minutes} className={value===minutes?'active':''} disabled={disabled} onClick={()=>onChange(minutes)}>{title}</button>)}</div>;
}
export function ReminderSettingsPage({user}:{user:User}){
  const [settings,setSettings]=useState<ReminderSettings|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[dirty,setDirty]=useState(false);
  const active=useRef(true),writeLock=useRef(false),reading=useRef(false);
  async function load(){
    if(writeLock.current||reading.current)return;reading.current=true;setLoading(true);setError('');
    try{const value=await api<ReminderSettings>('/reminder-settings');if(active.current){setSettings(value);setDirty(false);setConflict(false);}}catch(e){if(active.current)setError(errorMessage(e));}finally{reading.current=false;if(active.current)setLoading(false);}
  }
  useEffect(()=>{active.current=true;void load();return()=>{active.current=false;};},[]);
  async function save(next:ReminderSettings){
    if(writeLock.current||reading.current)return;writeLock.current=true;setSettings(next);setDirty(true);setSaving(true);setError('');setConflict(false);
    try{const result=await api<ReminderSettings>('/reminder-settings','PUT',reminderPayload(next));if(active.current){setSettings(result);setDirty(false);}}catch(e){if(active.current){setError(errorMessage(e));setConflict(e instanceof ApiError&&e.status===409);}}finally{writeLock.current=false;if(active.current)setSaving(false);}
  }
  function change(patch:Partial<ReminderPreferences>){if(settings)void save({...settings,...patch});}
  const disabled=loading||saving||conflict;
  const stateLabel=saving?'正在保存…':dirty?'更改尚未保存':settings?.updatedAt?'设置已自动保存':'当前为默认设置，调整后自动保存';
  return <div className="reminder-page"><div className="reminder-layout"><section className="workspace-card reminder-content"><header className="reminder-card-heading"><span className="reminder-symbol"><Bell size={22}/></span><div><h2>提醒内容</h2><p>自动保存到账号，换设备登录也能沿用。</p></div></header>
    <p className="reminder-mode-note">手机通知待接通 · 当前仅保存提醒偏好</p>
    <div className={`reminder-save-status ${dirty?'unsaved':''}`} role="status" aria-live="polite">{saving?<RefreshCw size={15}/>:dirty?<Bell size={15}/>:<Check size={15}/>}<span>{loading?'正在读取提醒设置…':stateLabel}</span></div>
    {error&&<div className="reminder-save-error"><p className="feedback" role="alert">{error}</p>{dirty&&!conflict&&settings&&<button type="button" className="secondary-button" disabled={saving} onClick={()=>void save(settings)}>重试保存</button>}<button type="button" className="text-button" disabled={saving||loading} onClick={()=>void load()}>{conflict?'读取最新设置':'重新读取设置'}</button></div>}
    {settings&&<><section className="reminder-section"><div className="reminder-section-heading"><div><h3><CalendarClock size={19}/>上课提醒</h3><p>提醒你课表中已选课程的上课时间与地点。</p></div><ReminderSwitch label="上课提醒" checked={settings.courseEnabled} disabled={disabled} onChange={value=>change({courseEnabled:value})}/></div><LeadOptions label="上课提前多久提醒" value={settings.courseLeadMinutes} disabled={disabled||!settings.courseEnabled} options={[[15,'提前15分钟'],[30,'提前30分钟'],[60,'提前1小时']]} onChange={value=>change({courseLeadMinutes:value})}/><div className="reminder-secondary-row"><div><strong>停课、调课与恢复通知</strong><p>仅关注你已选课程的课程变动。</p></div><ReminderSwitch label="停课调课与恢复通知" checked={settings.courseChangesEnabled} disabled={disabled} onChange={value=>change({courseChangesEnabled:value})}/></div></section>
    <section className="reminder-section"><div className="reminder-section-heading"><div><h3><ClipboardList size={19}/>作业发布与更新</h3><p>只接收已选课程的作业发布及内容更新。</p></div><ReminderSwitch label="作业发布与更新提醒" checked={settings.homeworkUpdatesEnabled} disabled={disabled} onChange={value=>change({homeworkUpdatesEnabled:value})}/></div></section>
    <section className="reminder-section"><div className="reminder-section-heading"><div><h3><Bell size={19}/>作业截止提醒</h3><p>已标记完成的当前版本作业不再提醒。</p></div><ReminderSwitch label="作业截止提醒" checked={settings.homeworkDueEnabled} disabled={disabled} onChange={value=>change({homeworkDueEnabled:value,...(value&&!settings.remindOfficialDeadline&&!settings.remindPersonalPlan?{remindOfficialDeadline:true}:{})})}/></div><LeadOptions label="作业提前多久提醒" value={settings.homeworkLeadMinutes} disabled={disabled||!settings.homeworkDueEnabled} options={[[60,'提前1小时'],[360,'提前6小时'],[1440,'提前1天'],[2880,'提前2天']]} onChange={value=>change({homeworkLeadMinutes:value})}/><fieldset className="reminder-time-basis" disabled={disabled||!settings.homeworkDueEnabled}><legend>按哪些时间提醒</legend><label className="checkbox-line"><input type="checkbox" checked={settings.remindOfficialDeadline} disabled={!settings.remindPersonalPlan&&settings.remindOfficialDeadline} onChange={e=>change({remindOfficialDeadline:e.target.checked})}/><span>截止时间<small>包括学委发布的截止和个人作业截止，截止时间始终保留。</small></span></label><label className="checkbox-line"><input type="checkbox" checked={settings.remindPersonalPlan} disabled={!settings.remindOfficialDeadline&&settings.remindPersonalPlan} onChange={e=>change({remindPersonalPlan:e.target.checked})}/><span>计划完成时间<small>在作业页面设置；没有设置时沿用作业原截止。</small></span></label><p>可同时选择，两者时间相同时只需提醒一次。</p></fieldset></section></>}
    <p className="reminder-scope-note">这些设置仅影响你自己的提醒，不改变课表、作业内容和其他同学的设置。手机通知接通后将按这些偏好执行。</p>
  </section><aside className="reminder-side"><section className="workspace-card reminder-delivery"><span className="reminder-account"><span/>{user.name} · 当前账号</span><Smartphone size={30}/><h2>手机通知尚未接通</h2><p>现在可以先保存提醒偏好。实际消息发送、手机接收和关闭网页后的提醒，将在后续接通后启用。</p><span className="reminder-pending-badge">偏好设置可用 · 消息发送待接通</span></section><section className="workspace-card reminder-help"><Cloud size={23}/><h3>设置跟随账号</h3><p>每位同学独立设置。管理员在个人中心也使用自己的提醒偏好。</p><details><summary>以后怎样开启手机接收？</summary><ol><li>接通课程和作业的消息发送服务。</li><li>在需要接收提醒的设备上完成开启步骤。</li><li>发送测试消息，确认可以收到。</li></ol><p>接通时会再提供具体操作说明，现在无需安装软件或授权通知。</p></details></section></aside></div></div>;
}
