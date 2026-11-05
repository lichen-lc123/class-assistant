// Courses belong to a semester by their source metadata, not by the bounds of
// the currently published calendars. Explicit dates remain independent of weeks.
export function expandSchedule(course,term,{addDays}) {
  const warnings=[...(course.warnings||[])],notices=[],date_reviews=[];
  const periods=term.config.periods||[],calendars=term.config.calendars||[];
  const times=rule=>[rule.start_time||periods.find(p=>p.number===rule.period_start)?.start,rule.end_time||periods.find(p=>p.number===rule.period_end)?.end];
  const weekday=date=>new Date(date+'T00:00:00Z').getUTCDay()||7;
  const make=(date,start,end,room,kind='lecture',lesson=null,source='weekly')=>{
    if(!date||!start||!end)return null;
    if(start===end){warnings.push('课程起止时刻相同，请确认。');return null;}
    return{date,start_time:start,end_time:end,start:`${date}T${start}:00+08:00`,end:`${end<start?addDays(date,1):date}T${end}:00+08:00`,room:kind==='practice'?null:room||course.room||null,kind,lesson_number:lesson,_explicitLesson:Boolean(lesson),_source:source};
  };
  let sessions=[];
  function add(session){
    if(!session)return'pending';
    const existing=sessions.find(s=>s.start===session.start&&s.end===session.end);
    if(!existing){sessions.push(session);return'added';}
    if(session.kind==='practice'&&existing.kind!=='practice'){
      sessions=sessions.filter(s=>s!==existing);sessions.push(session);return'merged';
    }
    if(existing.kind!=='practice'&&session.kind!=='practice'){
      if(existing.room&&session.room&&existing.room!==session.room)warnings.push(`${session.date} 同一课次出现不同教室，已${existing._source==='weekly'?'采用周次教室':'保留原有教室'}，请核对原文。`);
      if(!existing.room&&session.room)existing.room=session.room;
    }
    if(session._explicitLesson){
      if(existing._explicitLesson&&existing.lesson_number!==session.lesson_number)warnings.push(`${session.date} 同一次课出现不同课次编号，请核对。`);
      else{existing.lesson_number=session.lesson_number;existing._explicitLesson=true;}
    }
    return'merged';
  }

  let incompleteWeekly=false;
  for(const [i,rule] of course.weekly_rules.entries()){
    const calendar=rule.calendar_name?calendars.find(c=>c.name===rule.calendar_name):calendars.length===1?calendars[0]:null;
    const [start,end]=times(rule);
    if(!rule.weeks.length||!rule.weekday||!calendar||!start||!end){
      incompleteWeekly=true;
      warnings.push(`周次安排尚缺${!rule.weeks.length?'具体周次、':''}${!rule.weekday?'星期、':''}${!calendar?'对应教学周起点、':''}${!start||!end?'节次作息或具体时间':''}，已保留为待确认。`);continue;
    }
    for(const week of rule.weeks){
      const date=addDays(calendar.start_date,(week-1)*7+rule.weekday-weekday(calendar.start_date));
      if(calendar.end_date&&date>calendar.end_date){incompleteWeekly=true;warnings.push(`${date} 超出 ${calendar.name} 的教学周范围，未按该规则排课。`);continue;}
      const session=make(date,start,end,rule.room);
      if(session){session._rule=i+1;session._week=week;add(session);}
    }
  }
  const weekly=[...sessions].sort((a,b)=>a.start.localeCompare(b.start));
  weekly.forEach((session,i)=>{session._weeklyNumber=i+1;});
  const resolutions=Array.isArray(course.extra_fields?.['周次日期冲突处理'])?course.extra_fields['周次日期冲突处理'].filter(r=>r&&r.action==='use_weekly_rule'):[];
  const validResolutions=new Set();
  const review=(special,action,reason,target=null)=>date_reviews.push({date:special.date,lesson_number:special.lesson_number||null,action,reason,...(target?{weekly_date:target.date}:{})});
  function resolveConflict(special,index){
    const sameDateCount=course.special_dates.filter(s=>s.date===special.date).length;
    const matches=resolutions.filter(r=>r.date===special.date&&(r.special_date_index?r.special_date_index===index+1:r.lesson_number?special.lesson_number===r.lesson_number||(special.lesson_number==null&&sameDateCount===1):sameDateCount===1));
    if(!matches.length)return null;
    if(matches.length!==1){warnings.push(`${special.date} 有多条冲突处理信息，未自动排除该明确日期，请核对。`);return null;}
    const resolution=matches[0];validResolutions.add(resolution);
    let candidates=weekly;
    if(resolution.weekly_rule_index)candidates=candidates.filter(s=>s._rule===resolution.weekly_rule_index);
    if(resolution.week)candidates=candidates.filter(s=>s._week===resolution.week);
    if(resolution.lesson_number&&!resolution.week&&!resolution.weekly_rule_index&&!incompleteWeekly)candidates=candidates.filter(s=>s._weeklyNumber===resolution.lesson_number);
    else if(!resolution.week&&!resolution.weekly_rule_index)candidates=candidates.filter(s=>s.date===special.date);
    if(candidates.length!==1||!resolution.reason){warnings.push(`${special.date} 的冲突标记未能唯一对应完整周次安排，已保留日期，请核对。`);return null;}
    const target=candidates[0],[start,end]=times(special);
    if(!sessions.includes(target)){warnings.push(`${special.date} 对应的周次课次已有例外调整，未自动排除该日期，请核对。`);return null;}
    const different=target.date!==special.date||(start&&start!==target.start_time)||(end&&end!==target.end_time)||(special.kind!=='practice'&&special.room&&target.room&&special.room!==target.room);
    if(!different)return null;
    warnings.push(`${special.date} 的备注与 ${target.date} 的同一课次存在已标明冲突，已以上课周安排为准；备注日期仅保留供核对。${resolution.reason}`);
    review(special,'weekly_preferred',resolution.reason,target);
    return target;
  }
  const allTimeRules=[...course.weekly_rules,...course.explicit_sessions];
  function fallback(special,target){
    const own=times(special);
    const sameDay=weekly.filter(s=>s.date===special.date&&(!own[0]||s.start_time===own[0])&&(!own[1]||s.end_time===own[1]));
    const numbered=special.lesson_number&&!incompleteWeekly?weekly.filter(s=>s._weeklyNumber===special.lesson_number):[];
    const matchingRules=course.weekly_rules.filter(r=>r.weekday===weekday(special.date));
    const groups=[target?[target]:[],sameDay,numbered,matchingRules,allTimeRules];
    for(const group of groups){
      const options=group.map(rule=>{const [start,end]=times(rule);return{start,end,room:rule.room};}).filter(t=>t.start&&t.end&&(!own[0]||t.start===own[0])&&(!own[1]||t.end===own[1]));
      const pairs=[...new Set(options.map(t=>t.start+'|'+t.end))];
      if(pairs.length===1){const [start,end]=pairs[0].split('|'),rooms=[...new Set(options.map(t=>t.room).filter(Boolean))];return{start:own[0]||start,end:own[1]||end,room:rooms.length===1?rooms[0]:null};}
      if(pairs.length>1)break;
    }
    return{start:own[0],end:own[1],room:null};
  }

  for(const [index,special] of course.special_dates.entries()){
    if(!special.date){warnings.push('备注中存在年份或日期待确认的安排。');review(special,'pending','年份或日期尚未明确，保留原文等待核对。');continue;}
    if(resolveConflict(special,index))continue;
    if(special.weekday&&special.weekday!==weekday(special.date))warnings.push(`${special.date} 与备注中的星期不一致，日期已保留，请核对。`);
    if(special.kind==='unknown')warnings.push(`${special.date} 的备注安排类型待确认，明确日期已保留，不自动覆盖周次安排。`);
    let target=null;
    if(special.kind==='reschedule'){
      let candidates=special.original_date?weekly.filter(s=>s.date===special.original_date):special.lesson_number&&!incompleteWeekly?weekly.filter(s=>s._weeklyNumber===special.lesson_number):[];
      const own=times(special);
      if(candidates.length>1&&(own[0]||own[1]))candidates=candidates.filter(s=>(!own[0]||s.start_time===own[0])&&(!own[1]||s.end_time===own[1]));
      if(candidates.length!==1){warnings.push(`${special.date} 调课缺少唯一可确认的原日期或课次，原安排和备注均保留待核对。`);review(special,'pending','未能唯一确定调课前的课次。');continue;}
      target=candidates[0];
      if(!sessions.includes(target)){warnings.push(`${special.date} 调课对应的原课次已被其他备注调整，已保留待确认。`);review(special,'pending','原课次已发生其他调整，不能再次自动替换。');continue;}
    }
    const timing=fallback(special,target);
    if(!timing.start||!timing.end){warnings.push(`${special.date} 的备注安排缺少唯一可确定的起止时间，已保留待确认。`);review(special,'pending','日期已保留，仍需补充明确起止时间。');continue;}
    const session=make(special.date,timing.start,timing.end,special.room||target?.room||timing.room,special.kind,special.lesson_number,'special');
    if(!session)continue;
    if(target)sessions=sessions.filter(s=>s!==target);
    const action=add(session);
    review(special,action,action==='merged'?'与已有课次相同，合并信息，只计一次。':special.kind==='reschedule'?'原文明示调课，替换对应原课次。':special.kind==='practice'?'保留实践活动，同一时间不重复安排普通课堂。':'明确日期独立排入，不要求同时具备周次。');
  }
  for(const resolution of resolutions)if(!validResolutions.has(resolution))warnings.push(`${resolution.date||'未明确日期'} 的冲突标记未匹配到备注，未据此删减任何安排，请核对。`);
  for(const explicit of course.explicit_sessions){
    const session=make(explicit.date,explicit.start_time,explicit.end_time,explicit.room,explicit.kind,explicit.lesson_number,'explicit');
    add(session);
  }
  sessions.sort((a,b)=>a.start.localeCompare(b.start));
  const explicitNumbers=new Map();
  for(const s of sessions)if(s._explicitLesson){
    if(explicitNumbers.has(s.lesson_number))warnings.push(`第 ${s.lesson_number} 次课对应多个不同日期，均已保留，请核对是否同一次课。`);
    explicitNumbers.set(s.lesson_number,s);
  }
  const used=new Set(explicitNumbers.keys());let nextNumber=1;
  for(const s of sessions){if(!s._explicitLesson){while(used.has(nextNumber))nextNumber++;s.lesson_number=nextNumber;used.add(nextNumber++);}if(s.kind!=='practice'&&!s.room)warnings.push(`${s.date} 的教室待通知。`);}
  for(let i=0;i<sessions.length;i++)for(let j=i+1;j<sessions.length&&sessions[j].start<sessions[i].end;j++)warnings.push(`${sessions[j].date} 本课程有不同起止时间的重叠安排，均已保留，请核对是否同一课次。`);
  const outside=sessions.filter(s=>s._source!=='weekly'&&((term.startsOn&&s.date<term.startsOn)||(term.endsOn&&s.date>term.endsOn)||(calendars.length&&!calendars.some(c=>c.start_date<=s.date&&(!c.end_date||s.date<=c.end_date))))).map(s=>s.date);
  if(outside.length)notices.push(`${[...new Set(outside)].join('、')} 超出现有学期或教学日历范围，仍按明确日期保留在本学期课程中，不要求配置后续日期区间的校历。`);
  if(!calendars.length&&sessions.some(s=>s._source!=='weekly'))notices.push('明确日期已独立生成课次，不依赖教学周日历。');
  for(const note of Array.isArray(course.extra_fields?.['日期说明'])?course.extra_fields['日期说明']:[])if(typeof note==='string')notices.push(note.slice(0,2000));
  if(!sessions.length)warnings.push('尚无可确定的上课时间，课程保留在待安排中。');
  const clean=sessions.map(({_explicitLesson,_source,_rule,_week,_weeklyNumber,...session})=>session);
  return{sessions:clean,warnings:[...new Set(warnings)],notices:[...new Set(notices)],date_reviews,schedule_status:!clean.length?'pending':warnings.length?'needs_review':'ready'};
}
