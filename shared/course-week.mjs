const DAY=86400000;
const monday=date=>{const time=Date.parse(date+'T00:00:00Z');return time-((new Date(time).getUTCDay()||7)-1)*DAY;};
const validDate=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
export function primaryTeachingCalendar(term){
  const calendars=(term.config?.calendars||[]).filter(c=>validDate(c.start_date)).slice().sort((a,b)=>a.start_date.localeCompare(b.start_date)||(b.end_date||'9999').localeCompare(a.end_date||'9999'));
  return calendars.find(c=>c.start_date===term.startsOn)||calendars[0]||(validDate(term.startsOn)?{name:'学期教学周',start_date:term.startsOn,...(term.endsOn?{end_date:term.endsOn}:{})}:null);
}
export function semesterCalendarConfig(config,startsOn,endsOn){
  const primary=primaryTeachingCalendar({config,startsOn,endsOn});
  const {sourceCalendars:existing=[],...rest}=config;
  const sourceCalendars=[...new Map([...existing,...(config.calendars||[])].filter(c=>c.name!=='学期教学周').map(c=>[c.name,c])).values()];
  return{...rest,calendars:primary?[{...primary,name:'学期教学周',...(endsOn?{end_date:endsOn}:{})}]:[],...(sourceCalendars.length?{sourceCalendars}:{})};
}
export function courseTeachingWeek(date,course,term){
  if(!validDate(date))return null;
  const primary=primaryTeachingCalendar(term);
  if(primary){
    if(date<primary.start_date||primary.end_date&&date>primary.end_date&&![...(course.explicit_sessions||[]),...(course.special_dates||[])].some(s=>s.date===date))return null;
    const week=Math.floor((monday(date)-monday(primary.start_date))/(7*DAY))+1;
    return week>0&&week<=60?week:null;
  }
  const explicit=(course.explicit_sessions||[]).filter(s=>s.date&&Number.isInteger(s.week)&&s.week>0&&s.week<=60);
  const direct=[...new Set(explicit.filter(s=>s.date===date).map(s=>s.week))];
  if(direct.length)return direct.length===1?direct[0]:null;
  const calendars=term.config?.calendars||[];
  const anchors=explicit.map(s=>monday(s.date)-(s.week-1)*7*DAY);
  for(const rule of course.weekly_rules||[]){const calendar=calendars.find(c=>c.name===rule.calendar_name);if(calendar)anchors.push(monday(calendar.start_date));}
  const unique=[...new Set(anchors)];
  const from=anchor=>{const week=Math.floor((monday(date)-anchor)/(7*DAY))+1;return week>0&&week<=60?week:null;};
  if(unique.length)return unique.length===1?from(unique[0]):null;
  const weeks=[...new Set(calendars.filter(c=>date>=c.start_date&&(!c.end_date||date<=c.end_date)).map(c=>from(monday(c.start_date))).filter(Boolean))];
  return weeks.length===1?weeks[0]:null;
}
