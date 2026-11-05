import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../app.mjs';
import { createInitialAdmin, hashPassword } from '../database.mjs';
import { validateTerm, normalizeCourse, expandCourse } from '../schedule.mjs';
import { calendarImport } from '../academic-calendar.mjs';
import { academicCalendarWarnings, calendarWeekRows } from '../../shared/academic-calendar.mjs';

const example=JSON.parse(readFileSync(new URL('../../需求文档/课表功能/校历示例-2026秋冬.json',import.meta.url),'utf8'));
const draft=()=>calendarImport({text:JSON.stringify(example)},validateTerm);
test('完整AI结果一次映射全部网站字段，并兼容代码围栏和无须手填的显示默认值',()=>{
  const t=calendarImport({text:'\uFEFF```json\n'+JSON.stringify(example)+'\n```'},validateTerm);
  assert.equal(t.academicYear,example.academic_year);assert.equal(t.name,example.semester);assert.equal(t.startsOn,example.starts_on);assert.equal(t.endsOn,example.ends_on);
  assert.deepEqual(t.config.aliases,example.aliases);assert.deepEqual(t.config.calendars,example.calendars);assert.deepEqual(t.config.periods,example.periods);assert.deepEqual(t.config.schoolCalendar,example.school_calendar);
  const optional=structuredClone(example);for(const key of ['title','source_name','display_start','display_end'])delete optional.school_calendar[key];
  const completed=calendarImport({data:optional},validateTerm);
  assert.ok(completed.config.schoolCalendar.title.includes(completed.name));assert.equal(completed.config.schoolCalendar.source_name,'外部 AI 校历提取结果');assert.equal(completed.config.schoolCalendar.display_start,completed.startsOn);assert.equal(completed.config.schoolCalendar.display_end,completed.endsOn);
});
test('校历图片样例保留14节作息、跨年日期、24个上课日及各学季教学周',()=>{
  const t=draft(),rows=calendarWeekRows(t);
  assert.equal(rows.length,23);assert.equal(rows[0].start,'2026-08-17');assert.equal(rows.at(-1).end,'2027-01-24');
  assert.equal(t.config.periods.length,14);assert.equal(t.config.periods[13].end,'21:15');assert.equal(t.config.periods[5].start,'13:25');assert.equal(t.config.periods[10].section,'晚上');
  const winter=rows.find(r=>r.start==='2026-11-09');assert.equal(winter.weeks.find(c=>c.name==='工程师学院冬').week,1);assert.equal(winter.weeks.find(c=>c.name==='工程师学院秋冬').week,9);assert.equal(winter.weeks.some(c=>c.name==='工程师学院秋'),false);
  assert.equal(rows.flatMap(r=>r.days).filter(d=>d.events.some(e=>e.kind==='class')).length,24);
  assert.ok(rows.find(r=>r.start==='2026-12-28').days.find(d=>d.date==='2027-01-01').events.some(e=>e.kind==='holiday'));
  assert.ok(academicCalendarWarnings(t).some(w=>w.includes('同时标记')));
});
test('校历导入拒绝错误格式、无效日期及重复节次，保留无法确定事项',()=>{
  assert.throws(()=>calendarImport({text:'bad'},validateTerm),/合法 JSON/);
  assert.throws(()=>calendarImport({data:{schema_version:'timetable.v1'}},validateTerm),/academic-calendar.v1/);
  let bad=structuredClone(example);bad.school_calendar.events[0].start_date='2026-02-30';assert.throws(()=>calendarImport({data:bad},validateTerm),/日期/);
  bad=structuredClone(example);bad.school_calendar.events[0].end_date='2026-01-01';assert.throws(()=>calendarImport({data:bad},validateTerm),/日期/);
  bad=structuredClone(example);bad.periods[1].number=1;assert.throws(()=>calendarImport({data:bad},validateTerm),/重复/);
  bad=structuredClone(example);bad.school_calendar.display_end='2028-01-01';assert.throws(()=>calendarImport({data:bad},validateTerm),/400/);
  assert.ok(draft().config.schoolCalendar.warnings.some(w=>w.includes('待')||w.includes('核对')));
});
test('校级停课或寒假备注不会取消非全日制课程；教学周遵守各自结束范围',()=>{
  const t=draft();
  const course=calendar=>normalizeCourse({course_name:'课程',weekly_rules:[{calendar_name:calendar,weeks:[17,18],weekday:6,period_start:6,period_end:9}]},t);
  assert.deepEqual(expandCourse(course('工程师学院秋冬'),t).sessions.map(s=>s.date),['2027-01-09','2027-01-16']);
  const short=normalizeCourse({course_name:'秋课',weekly_rules:[{calendar_name:'工程师学院秋',weeks:[9],weekday:6,period_start:6,period_end:9}]},t);
  assert.equal(expandCourse(short,t).sessions.length,0);assert.ok(expandCourse(short,t).warnings.some(w=>w.includes('教学周范围')));
});
test('校历预览不写数据库，只有管理员核对确认后可保存和更新',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});
  await createInitialAdmin(db,'calendar-admin','管理员','CalendarAdmin123');
  db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run('calendar-student','同学',await hashPassword('CalendarStudent123'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,method='GET',body,cookie){const r=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json',Origin:base}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login','POST',{studentId:'calendar-admin',password:'CalendarAdmin123'})).cookie;
  const student=(await call('/auth/login','POST',{studentId:'calendar-student',password:'CalendarStudent123'})).cookie;
  assert.equal((await call('/admin/timetable/calendar-preview','POST',{data:example})).status,401);
  for(const path of ['/admin/timetable/calendar-prompt','/admin/timetable/calendar-example'])assert.equal((await call(path,'GET',undefined,student)).status,403);
  assert.equal((await call('/admin/timetable/calendar-preview','POST',{data:example},student)).status,403);
  assert.ok((await call('/admin/timetable/calendar-prompt','GET',undefined,admin)).data.text.includes('academic-calendar.v1'));
  const preview=await call('/admin/timetable/calendar-preview','POST',{data:example},admin);assert.equal(preview.status,200);assert.equal(db.prepare('SELECT count(*) AS n FROM terms').get().n,0);
  assert.equal((await call('/admin/timetable/terms','POST',preview.data.term,admin)).status,400);
  const saved=await call('/admin/timetable/terms','POST',{...preview.data.term,calendarConfirmed:true},admin);assert.equal(saved.status,201);assert.equal(saved.data.config.schoolCalendar.events.length,46);
  const payload={...saved.data,config:{...saved.data.config,schoolCalendar:{...saved.data.config.schoolCalendar,title:'已核对校历'}}};
  assert.equal((await call(`/admin/timetable/terms/${saved.data.id}`,'PUT',{...payload,calendarConfirmed:true},student)).status,403);
  assert.equal((await call(`/admin/timetable/terms/${saved.data.id}`,'PUT',payload,admin)).status,400);
  assert.equal((await call(`/admin/timetable/terms/${saved.data.id}`,'PUT',{...payload,calendarConfirmed:true},admin)).status,200);
  assert.equal((await call(`/admin/timetable/terms/${saved.data.id}`,'PUT',{...payload,calendarConfirmed:true},admin)).status,409);
  const read=(await call('/timetable/terms','GET',undefined,student)).data.terms[0];assert.equal(read.config.schoolCalendar.title,'已核对校历');assert.equal(read.config.periods.length,14);
});
