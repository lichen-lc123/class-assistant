import { expandSchedule } from './schedule-expansion.mjs';
import { normalizeAcademicCalendar } from './academic-calendar.mjs';
import {semesterCalendarConfig} from '../shared/course-week.mjs';
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
  if(config.sourceCalendars!=null&&(!Array.isArray(config.sourceCalendars)||config.sourceCalendars.length>40))problem('历史教学周资料最多40项。');
  const sourceCalendars=list(config.sourceCalendars).map(c=>({name:trim(c?.name,80),start_date:c?.start_date,...(c?.end_date?{end_date:c.end_date}:{})}));
  if(sourceCalendars.some(c=>!c.name||!validDate(c.start_date)||c.end_date&&(!validDate(c.end_date)||c.end_date<c.start_date)))problem('历史教学周资料日期不正确。');
  const periods = list(config.periods).map(p => ({ number: integer(p?.number, 30), start: p?.start, end: p?.end, ...(p?.section?{section:trim(p.section,20)}:{}) }));
  if (periods.some(p => !p.number || !validTime(p.start) || !validTime(p.end) || p.end<=p.start)) problem('节次和起止时间不正确。');
  if (new Set(periods.map(p=>p.number)).size !== periods.length) problem('节次编号不能重复。');
  const schoolCalendar = normalizeAcademicCalendar(config.schoolCalendar);
  return { academicYear, name, startsOn, endsOn, config: semesterCalendarConfig({ calendars, sourceCalendars, periods, aliases: list(config.aliases).map(a=>trim(a,60)).filter(Boolean).slice(0,20), ...(schoolCalendar?{schoolCalendar}:{}) },startsOn,endsOn) };
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
  if (raw.semester && !matchesSemester(raw.semester, term)) problem(`${course_name} 的学期与当前所选学期不一致，请核对网站目标学期名称。`);
  for(const [field,max] of [['weekly_rules',30],['special_dates',100],['explicit_sessions',200]]) {
    if(raw[field]!=null&&!Array.isArray(raw[field]))problem(`${course_name} 的 ${field} 必须是数组，请修正导入结果。`);
    if(raw[field]?.length>max)problem(`${course_name} 的 ${field} 条数超过上限 ${max}，请拆分核对，不会自动截断。`);
  }
  const source_warnings=list(Array.isArray(raw.source_warnings)?raw.source_warnings:raw.warnings).filter(x=>typeof x==='string'&&!/上课班编号|班号|班级编号/.test(x)).slice(0,30).map(x=>x.slice(0,250));
  const warnings=[...source_warnings];
  const weekly_rules = list(raw.weekly_rules).slice(0,30).map(rule=>{
    if(!rule||typeof rule!=='object'||Array.isArray(rule))problem('周次安排条目格式不正确。');
    const weeks = [...new Set(list(rule.weeks).map(w=>integer(w,60)).filter(Boolean))].sort((a,b)=>a-b);
    if (list(rule.weeks).length !== list(rule.weeks).filter(w=>integer(w,60)).length) problem(`${course_name} 的周次需为 1—60 的整数。`);
    const weekday = rule.weekday == null ? null : integer(rule.weekday,7);
    if (rule.weekday != null && !weekday) problem(`${course_name} 的星期需为 1—7。`);
    for (const field of ['start_time','end_time']) if (rule[field] && !validTime(rule[field])) problem(`${course_name} 的时间需为 HH:mm。`);
    return { calendar_name: trim(rule.calendar_name,80)||null,
      weeks, weekday, week_parity_raw:trim(rule.week_parity_raw,100)||null,
      period_start: integer(rule.period_start,30), period_end: integer(rule.period_end,30),
      start_time: rule.start_time || null, end_time: rule.end_time || null,
      room: trim(rule.room,120)||null, raw:trim(rule.raw,4000) };
  });
  const special_dates = list(raw.special_dates).slice(0,100).map(s=>{
    if(!s||typeof s!=='object'||Array.isArray(s))problem('备注日期条目格式不正确。');
    if (s.date && !validDate(s.date)) problem(`${course_name} 的日期无效。`);
    for (const field of ['start_time','end_time']) if (s[field] && !validTime(s[field])) problem(`${course_name} 的时间需为 HH:mm。`);
    if(s.weekday!=null&&!integer(s.weekday,7))problem(`${course_name} 的备注星期需为1—7。`);
    const kind=['lecture','supplement','reschedule','practice','unknown'].includes(s.kind)?s.kind:'unknown';
    return { date:s.date||null, weekday:integer(s.weekday,7), lesson_number:integer(s.lesson_number,200), kind,
      original_date:s.original_date&&validDate(s.original_date)?s.original_date:null,
      start_time:s.start_time||null,end_time:s.end_time||null,
      period_start:integer(s.period_start,30),period_end:integer(s.period_end,30),
      room:kind==='practice'?null:trim(s.room,120)||null,raw:trim(s.raw,2000) };
  });
  const explicit_sessions = list(raw.explicit_sessions).slice(0,200).map(s=>{
    if(!s||typeof s!=='object'||Array.isArray(s))problem('具体上课安排条目格式不正确。');
    if (!validDate(s.date) || !validTime(s.start_time) || !validTime(s.end_time) || s.start_time===s.end_time) problem(`${course_name} 的具体上课日期与起止时间不完整或无效。`);
    if(s.lesson_number!=null&&!integer(s.lesson_number,200))problem('第几次课只能填写 1—200 的整数。');
    if(s.week!=null&&!integer(s.week,60))problem('上课周次只能填写 1—60 的整数。');
    const weekday=new Date(s.date+'T00:00:00Z').getUTCDay()||7;
    if(s.weekday!=null&&Number(s.weekday)!==weekday)problem('星期与上课日期不一致，请核对。');
    return {date:s.date,start_time:s.start_time,end_time:s.end_time,room:trim(s.room,120)||null,kind:s.kind==='practice'?'practice':'lecture',lesson_number:integer(s.lesson_number,200),...(s.week!=null?{week:integer(s.week,60)}:{}),...(s.weekday!=null?{weekday}:{})};
  });
  const extra_fields=raw.extra_fields&&typeof raw.extra_fields==='object'&&!Array.isArray(raw.extra_fields)?{...raw.extra_fields}:{};
  const knownRoom=value=>{const room=trim(value,120);return room&&!/^(待通知|待安排|待确认|未知|未定|地点待通知|教室待通知)$/.test(room)?room:null;};
  const defaultRoom=knownRoom(raw.room)||weekly_rules.map(r=>knownRoom(r.room)).find(Boolean)||[...explicit_sessions,...special_dates].filter(s=>s.kind!=='practice').sort((a,b)=>(a.date||'').localeCompare(b.date||'')).map(s=>knownRoom(s.room)).find(Boolean)||null;
  for(const session of [...weekly_rules,...explicit_sessions,...special_dates])if(session.kind!=='practice'&&!knownRoom(session.room))session.room=defaultRoom;
  const originalLabels=[...list(raw.seasons),...list(raw.weekly_rules).map(rule=>rule?.season)].filter(v=>typeof v==='string'&&v.trim()).map(v=>trim(v,120));
  if(originalLabels.length)extra_fields['原表标注']=[...new Set([...(Array.isArray(extra_fields['原表标注'])?extra_fields['原表标注']:[]),...originalLabels])];
  if(Object.hasOwn(extra_fields,'周次日期冲突处理')){
    const rows=extra_fields['周次日期冲突处理'];
    if(!Array.isArray(rows)||rows.length>100)problem('周次日期冲突处理必须为不超过100项的数组。');
    extra_fields['周次日期冲突处理']=rows.map(row=>{
      if(!row||typeof row!=='object'||Array.isArray(row)||row.action!=='use_weekly_rule'||!validDate(row.date))problem('冲突处理需包含有效日期及action=use_weekly_rule。');
      for(const [field,max] of [['lesson_number',200],['special_date_index',100],['weekly_rule_index',30],['week',60]])if(row[field]!=null&&!integer(row[field],max))problem('冲突处理中的课次或规则编号无效。');
      return{date:row.date,lesson_number:integer(row.lesson_number,200),special_date_index:integer(row.special_date_index,100),weekly_rule_index:integer(row.weekly_rule_index,30),week:integer(row.week,60),action:'use_weekly_rule',reason:trim(row.reason,2000)};
    });
  }
  return { course_name,course_code:trim(raw.course_code,60)||null,teaching_class_code:trim(raw.teaching_class_code,80)||null,
    academic_year:term.academicYear,semester:term.name,
    teacher:trim(raw.teacher,120)||null,room:defaultRoom,
    required_or_elective:trim(raw.required_or_elective,20)||null,college:trim(raw.college,80)||null,
    course_category:trim(raw.course_category,80)||null,credits:raw.credits==null?null:Number.isFinite(Number(raw.credits))?Number(raw.credits):null,
    enrollment_status:trim(raw.enrollment_status,60)||null,exam_time_raw:trim(raw.exam_time_raw,1000)||null,
    weekly_rules,special_dates,explicit_sessions,schedule_raw:trim(raw.schedule_raw,8000),remarks_raw:trim(raw.remarks_raw,8000),
    extra_fields,
    source_rows:list(raw.source_rows).slice(0,30).map(s=>({source:trim(s.source,120),row:integer(s.row,10000),raw:trim(s.raw,8000)})),
    source_warnings,warnings:[...new Set(warnings)] };
}
export function expandCourse(course, term) { return expandSchedule(course,term,{addDays}); }
export function findConflicts(courses) {
  const all=courses.flatMap(c=>c.sessions.map(s=>({...s,entryId:c.id,courseName:c.course_name})) ).sort((a,b)=>a.start.localeCompare(b.start));
  const found=[];
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length&&all[j].start<all[i].end;j++){
    if(all[i].entryId!==all[j].entryId&&all[i].start<all[j].end){found.push({date:all[j].date,first:all[i].courseName,second:all[j].courseName,start:all[j].start});if(found.length>=100)return found;}
  }
  return found;
}
