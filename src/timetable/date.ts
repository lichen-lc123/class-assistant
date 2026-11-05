export function today() {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export const shiftDate=(date:string,n:number)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function bounds(view:string,date:string,start?:string|null,end?:string|null):[string|null,string|null] {
  if(view==='term')return[start||null,end?shiftDate(end,1):null];
  if(view==='month'){const first=date.slice(0,7)+'-01';const next=new Date(first+'T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);return[first,next.toISOString().slice(0,10)];}
  if(view==='week'){const day=new Date(date+'T00:00:00Z').getUTCDay()||7;const monday=shiftDate(date,1-day);return[monday,shiftDate(monday,7)];}
  return[date,shiftDate(date,1)];
}
export function moveReference(view:string,date:string,direction:number){
  if(view==='month'){const d=new Date(date.slice(0,7)+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+direction);return d.toISOString().slice(0,10);}
  return shiftDate(date,direction*(view==='week'?7:1));
}
export const humanDate=(date:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long'}).format(new Date(date+'T12:00:00+08:00'));

export function weekdayNumber(date:string):number|null {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const parsed=new Date(date+'T00:00:00Z');
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return null;
  return parsed.getUTCDay()||7;
}
export function weekdayLabel(date:string){const day=weekdayNumber(date);return day?'星期'+'一二三四五六日'[day-1]:'星期待确认';}
export function courseWeekdayLabels(sessions:{date:string}[]){
  const days=new Set(sessions.map(session=>weekdayNumber(session.date)).filter((day):day is number=>day!==null));
  return [...days].sort((a,b)=>a-b).map(day=>'星期'+'一二三四五六日'[day-1]);
}
