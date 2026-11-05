import { normalizeAcademicCalendar } from './academic-calendar.mjs';
export function problem(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
export const trim = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export const validTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const addDays = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
export const todayShanghai = (now = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const list = (value) => Array.isArray(value) ? value : [];
const integer = (v, max) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= max ? Number(v) : null;
export function validateTerm(body) {
  const academicYear = trim(body.academicYear, 30), name = trim(body.name, 60);
  if (!/^\d{4}-\d{4}$/.test(academicYear) || Number(academicYear.slice(5)) !== Number(academicYear.slice(0,4)) + 1) problem('学年格式应为连续年份，例如 2026-2027。');
  if (!name) problem('请输入学期名称。');
  const startsOn = body.startsOn || null, endsOn = body.endsOn || null;
  if ((startsOn && !validDate(startsOn)) || (endsOn && !validDate(endsOn)) || Boolean(startsOn) !== Boolean(endsOn)) problem('请同时填写有效的学期开始、结束日期，或同时留空。');
  if (startsOn && (endsOn < startsOn || Date.parse(endsOn)-Date.parse(startsOn)>370*86400000)) problem('学期日期范围不正确，最多一年。');
  const config = body.config || {};
  if (typeof config !== 'object' || Array.isArray(config)) problem('日历配置不正确。');
  if(config.calendars != null && (!Array.isArray(config.calendars)||config.calendars.length>20))problem('教学周日历最多 20 项。');
  if(config.periods != null && (!Array.isArray(config.periods)||config.periods.length>30))problem('节次作息最多 30 项。');
  const calendars = list(config.calendars).map(c => ({ name: trim(c?.name, 80), start_date: c?.start_date, ...(c?.end_date?{end_date:c.end_date}:{}) }));
  if (calendars.some(c => !c.name || !validDate(c.start_date))) problem('周历名称与第 1 周起点日期均需填写。');
  if (calendars.some(c => c.end_date&&(!validDate(c.end_date)||c.end_date<c.start_date))) problem('教学周结束日期不正确。');
  if (new Set(calendars.map(c=>c.name)).size !== calendars.length) problem('周历名称不能重复。');
  const periods = list(config.periods).map(p => ({ number: integer(p?.number, 30), start: p?.start, end: p?.end, ...(p?.section?{section:trim(p.section,20)}:{}) }));
  if (periods.some(p => !p.number || !validTime(p.start) || !validTime(p.end) || p.end<=p.start)) problem('节次和起止时间不正确。');
  if (new Set(periods.map(p=>p.number)).size !== periods.length) problem('节次编号不能重复。');
  const schoolCalendar = normalizeAcademicCalendar(config.schoolCalendar);
  return { academicYear, name, startsOn, endsOn, config: { calendars, periods, aliases: list(config.aliases).map(a=>trim(a,60)).filter(Boolean).slice(0,20), ...(schoolCalendar?{schoolCalendar}:{}) } };
}
const normalYear = v => trim(v).replace(/学年.*/, '').replace(/[—–－]/g, '-');
export function matchesSemester(value, term) {
  const raw = trim(value).replace(/\s/g, '');
  if (!raw) return true;
  const normalize = s => s.replace(/学期|学季|课表/g, '');
  return [term.name, ...(term.config.aliases || [])].some(a => normalize(a) === normalize(raw));
}
export function normalizeCourse(raw, term) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) problem('课程条目格式不正确。');
  const course_name = trim(raw.course_name, 120);
  if (!course_name) problem('课程名称不能为空。');
  if (raw.academic_year && normalYear(raw.academic_year) !== term.academicYear) problem(`${course_name} 不属于所选学年。`);
  if (raw.semester && !matchesSemester(raw.semester, term)) problem(`${course_name} 的学期与当前所选学期不一致，请分别导入或配置学季别名。`);
  for(const [field,max] of [['weekly_rules',30],['special_dates',100],['explicit_sessions',200]]) {
    if(raw[field]!=null&&!Array.isArray(raw[field]))problem(`${course_name} 的 ${field} 必须是数组，请修正导入结果。`);
    if(raw[field]?.length>max)problem(`${course_name} 的 ${field} 条数超过上限 ${max}，请拆分核对，不会自动截断。`);
  }
  const warnings = list(raw.warnings).filter(x=>typeof x==='string').slice(0,30).map(x=>x.slice(0,250));
  const weekly_rules = list(raw.weekly_rules).slice(0,30).map(rule=>{
    if(!rule||typeof rule!=='object'||Array.isArray(rule))problem('周次安排条目格式不正确。');
    const weeks = [...new Set(list(rule.weeks).map(w=>integer(w,60)).filter(Boolean))].sort((a,b)=>a-b);
    if (list(rule.weeks).length !== list(rule.weeks).filter(w=>integer(w,60)).length) problem(`${course_name} 的周次需为 1—60 的整数。`);
    const weekday = rule.weekday == null ? null : integer(rule.weekday,7);
    if (rule.weekday != null && !weekday) problem(`${course_name} 的星期需为 1—7。`);
    for (const field of ['start_time','end_time']) if (rule[field] && !validTime(rule[field])) problem(`${course_name} 的时间需为 HH:mm。`);
    return { season: trim(rule.season,60)||null, calendar_name: trim(rule.calendar_name,80)||null,
      weeks, weekday, week_parity_raw:trim(rule.week_parity_raw,100)||null,
      period_start: integer(rule.period_start,30), period_end: integer(rule.period_end,30),
      start_time: rule.start_time || null, end_time: rule.end_time || null,
      room: trim(rule.room,120)||null, raw:trim(rule.raw,4000) };
  });
  const special_dates = list(raw.special_dates).slice(0,100).map(s=>{
    if(!s||typeof s!=='object'||Array.isArray(s))problem('备注日期条目格式不正确。');
    if (s.date && !validDate(s.date)) problem(`${course_name} 的日期无效。`);
    for (const field of ['start_time','end_time']) if (s[field] && !validTime(s[field])) problem(`${course_name} 的时间需为 HH:mm。`);
    const kind=['lecture','supplement','reschedule','practice','unknown'].includes(s.kind)?s.kind:'unknown';
    return { date:s.date||null, lesson_number:integer(s.lesson_number,200), kind,
      original_date:s.original_date&&validDate(s.original_date)?s.original_date:null,
      start_time:s.start_time||null,end_time:s.end_time||null,
      period_start:integer(s.period_start,30),period_end:integer(s.period_end,30),
      room:kind==='practice'?null:trim(s.room,120)||null,raw:trim(s.raw,2000) };
  });
  const explicit_sessions = list(raw.explicit_sessions).slice(0,200).map(s=>{
    if(!s||typeof s!=='object'||Array.isArray(s))problem('具体上课安排条目格式不正确。');
    if (!validDate(s.date) || !validTime(s.start_time) || !validTime(s.end_time) || s.start_time===s.end_time) problem(`${course_name} 的具体上课日期与起止时间不完整或无效。`);
    return {date:s.date,start_time:s.start_time,end_time:s.end_time,room:trim(s.room,120)||null,kind:s.kind==='practice'?'practice':'lecture'};
  });
  if (!raw.teaching_class_code) warnings.push('缺少上课班编号，暂不能自动关联班级作业。');
  return { course_name,course_code:trim(raw.course_code,60)||null,teaching_class_code:trim(raw.teaching_class_code,80)||null,
    academic_year:term.academicYear,semester:term.name,seasons:list(raw.seasons).map(s=>trim(s,60)).slice(0,10),
    teacher:trim(raw.teacher,120)||null,room:trim(raw.room,120)||null,
    required_or_elective:trim(raw.required_or_elective,20)||null,college:trim(raw.college,80)||null,
    course_category:trim(raw.course_category,80)||null,credits:raw.credits==null?null:Number.isFinite(Number(raw.credits))?Number(raw.credits):null,
    enrollment_status:trim(raw.enrollment_status,60)||null,exam_time_raw:trim(raw.exam_time_raw,1000)||null,
    weekly_rules,special_dates,explicit_sessions,schedule_raw:trim(raw.schedule_raw,8000),remarks_raw:trim(raw.remarks_raw,8000),
    extra_fields:raw.extra_fields&&typeof raw.extra_fields==='object'&&!Array.isArray(raw.extra_fields)?raw.extra_fields:{},
    source_rows:list(raw.source_rows).slice(0,30).map(s=>({source:trim(s.source,120),row:integer(s.row,10000),raw:trim(s.raw,8000)})),
    warnings:[...new Set(warnings)] };
}
export function expandCourse(course, term) {
  const warnings = [...course.warnings];
  if(!term.startsOn||!term.endsOn)warnings.push('学期起止日期尚未配置，无法核验安排是否跨学期，请管理员补充。');
  let sessions=[];
  const makeSession=(date,start,end,room,kind='lecture',lesson=null)=>{
    if(!date||!start||!end) return null;
    if(start===end) { warnings.push('课程起止时刻相同，请确认。'); return null; }
    if(term.startsOn && (date<term.startsOn||date>term.endsOn)){warnings.push(`${date} 不在所选学期内，未排入课表。`);return null;}
    const endDate=end<start?addDays(date,1):date;
    return {date,start_time:start,end_time:end,start:`${date}T${start}:00+08:00`,end:`${endDate}T${end}:00+08:00`,room:kind==='practice'?null:room||course.room||null,kind,lesson_number:lesson};
  };
  const times=rule=>{
    const start=rule.start_time||term.config.periods?.find(p=>p.number===rule.period_start)?.start;
    const end=rule.end_time||term.config.periods?.find(p=>p.number===rule.period_end)?.end;
    return [start,end];
  };
  for(const rule of course.weekly_rules){
    let calendar;
    if(rule.calendar_name) calendar=term.config.calendars?.find(c=>c.name===rule.calendar_name);
    else if(term.config.calendars?.length===1) calendar=term.config.calendars[0];
    const [start,end]=times(rule);
    if(!rule.weeks.length||!rule.weekday||!calendar||!start||!end){warnings.push(`周次安排尚缺${!rule.weeks.length?'具体周次、':''}${!rule.weekday?'星期、':''}${!calendar?'对应教学周起点、':''}${!start||!end?'节次作息或具体时间':''}，已保留为待确认。`);continue;}
    const originDay=new Date(calendar.start_date+'T00:00:00Z').getUTCDay()||7;
    for(const week of rule.weeks){
      const date=addDays(calendar.start_date,(week-1)*7+rule.weekday-originDay);
      if(calendar.end_date&&date>calendar.end_date){warnings.push(`${date} 超出 ${calendar.name} 的教学周范围，未按该规则排课。`);continue;}
      const s=makeSession(date,start,end,rule.room);if(s)sessions.push(s);
    }
  }
  sessions.sort((a,b)=>a.start.localeCompare(b.start));
  for(const [index,s] of sessions.entries()) s.lesson_number=index+1;
  for(const special of course.special_dates){
    if(!special.date){warnings.push('备注中存在年份或日期待确认的安排。');continue;}
    if(special.kind==='unknown'){warnings.push(`${special.date} 的备注安排类型待确认，未自动覆盖周次安排。`);continue;}
    const target=sessions.find(s=>s.date===special.date)||sessions.find(s=>s.lesson_number===special.lesson_number);
    if(special.kind==='supplement'&&special.lesson_number&&target&&target.date!==special.date)warnings.push(`第 ${special.lesson_number} 次课已有 ${target.date} 的安排，备注又给出 ${special.date}，请确认补课还是调课。`);
    const weeklyTimes=course.weekly_rules.map(times).filter(t=>t[0]&&t[1]);
    const uniqueTimes=[...new Set(weeklyTimes.map(t=>t.join('|')))];
    const fallback=target|| (uniqueTimes.length===1?{start_time:uniqueTimes[0].split('|')[0],end_time:uniqueTimes[0].split('|')[1]}:{});
    const own=times(special);
    const start=own[0]||fallback.start_time,end=own[1]||fallback.end_time;
    if(!start||!end){warnings.push(`${special.date} 的备注安排缺少起止时间，已保留待确认。`);continue;}
    if(special.kind==='reschedule'&&!special.original_date&&!special.lesson_number){warnings.push(`${special.date} 调课缺少原日期或课次，未自动替换。`);continue;}
    const sameDate=sessions.filter(s=>s.date===special.date);
    if(special.kind==='practice') sessions=sessions.filter(s=>s.date!==special.date);
    if(special.kind==='reschedule') sessions=sessions.filter(s=>special.original_date?s.date!==special.original_date:s.lesson_number!==special.lesson_number);
    if(special.kind!=='reschedule'&&special.kind!=='practice'&&sameDate.length){
      if(sameDate.some(s=>s.start_time!==start||s.end_time!==end)){warnings.push(`${special.date} 的周次与备注时间有冲突，请确认。`);}
      else continue;
    }
    const s=makeSession(special.date,start,end,special.room||target?.room,special.kind,special.lesson_number);if(s)sessions.push(s);
  }
  for(const explicit of course.explicit_sessions){const s=makeSession(explicit.date,explicit.start_time,explicit.end_time,explicit.room,explicit.kind);if(s)sessions.push(s);}
  const seen=new Set();sessions=sessions.filter(s=>{const key=s.start+s.end+(s.room||'')+s.kind;if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>a.start.localeCompare(b.start));
  if(!sessions.length) warnings.push('尚无可确定的上课时间，课程保留在待安排中。');
  return {sessions,warnings:[...new Set(warnings)],schedule_status:!sessions.length?'pending':warnings.length?'needs_review':'ready'};
}
export function findConflicts(courses) {
  const all=courses.flatMap(c=>c.sessions.map(s=>({...s,entryId:c.id,courseName:c.course_name})) ).sort((a,b)=>a.start.localeCompare(b.start));
  const found=[];
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length&&all[j].start<all[i].end;j++){
    if(all[i].entryId!==all[j].entryId&&all[i].start<all[j].end){found.push({date:all[j].date,first:all[i].courseName,second:all[j].courseName,start:all[j].start});if(found.length>=100)return found;}
  }
  return found;
}
