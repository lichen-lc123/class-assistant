import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCourse,expandCourse,validateTerm,findConflicts} from '../schedule.mjs';
import {courseTeachingWeek,semesterCalendarConfig} from '../../shared/course-week.mjs';
import {createApp} from '../app.mjs';
import {createInitialAdmin} from '../database.mjs';

const legacy={calendars:[{name:'原完整学期',start_date:'2026-09-14',end_date:'2027-01-15'},{name:'原前半段',start_date:'2026-09-14',end_date:'2026-11-08'},{name:'原后半段',start_date:'2026-11-09',end_date:'2027-01-15'}],periods:[],aliases:[]};
const input={academicYear:'2026-2027',name:'第一学期',startsOn:'2026-09-14',endsOn:'2027-01-15',config:legacy};
const term=validateTerm(input);
const lesson=(date,room=null,extra={})=>({date,start_time:'08:50',end_time:'12:25',room,...extra});

test('完整学期唯一周次，旧分段仅供解析原文，不再从后半学期第一周计数',()=>{
  assert.deepEqual(term.config.calendars,[{name:'学期教学周',start_date:'2026-09-14',end_date:'2027-01-15'}]);
  assert.equal(term.config.sourceCalendars.length,3);
  assert.deepEqual(semesterCalendarConfig(term.config,input.startsOn,input.endsOn),term.config);
  const course={course_name:'系统工程',explicit_sessions:[lesson('2026-10-17','教室甲',{week:5}),lesson('2026-10-31',null,{week:7}),lesson('2026-11-14'),lesson('2027-01-09'),lesson('2027-01-16')]};
  const expanded=expandCourse(normalizeCourse(course,term),term);
  assert.deepEqual(expanded.sessions.map(s=>s.week),[5,7,9,17,18]);
  assert.equal(courseTeachingWeek('2026-11-14',{explicit_sessions:[lesson('2026-11-14',null,{week:1})]},term),9);
  assert.equal(courseTeachingWeek('2026-02-30',{},term),null);
  assert.equal(expanded.review_status,'confirmed');
  assert.equal(expanded.sessions.at(-1).date,'2027-01-16');
});

test('保留旧分段规则的真实日期，显示周次换算为完整学期',()=>{
  const course=normalizeCourse({course_name:'旧规则课程',weekly_rules:[{calendar_name:'原后半段',weeks:[5],weekday:5,start_time:'13:25',end_time:'17:00',room:'教室乙'}]},term);
  const expanded=expandCourse(course,term);
  assert.equal(expanded.sessions[0].date,'2026-12-11');assert.equal(expanded.sessions[0].week,13);
});

test('同一课程缺失教室沿用明确教室，换教室和实践例外保留，其他课程不受影响',()=>{
  const raw={course_name:'教室继承课程',explicit_sessions:[lesson('2026-10-01'),lesson('2026-10-08','教室甲'),lesson('2026-10-15'),lesson('2026-10-22','教室乙'),lesson('2026-10-29',null,{kind:'practice'})]};
  const normalized=normalizeCourse(raw,term),expanded=expandCourse(normalized,term);
  assert.deepEqual(expanded.sessions.map(s=>s.room),['教室甲','教室甲','教室甲','教室乙',null]);
  assert.equal(raw.explicit_sessions[0].room,null);
  assert.equal(expandCourse(normalizeCourse({course_name:'没有地点的其他课程',explicit_sessions:[lesson('2026-10-01')]},term),term).sessions[0].room,null);
  assert.equal(expandCourse(normalizeCourse({course_name:'尚无安排'},term),term).schedule_status,'pending');
  const same=expandCourse(normalizeCourse({...raw,course_name:'冲突课程'},term),term);
  assert.ok(findConflicts([{id:'a',...expanded,course_name:'甲'},{id:'b',...same,course_name:'乙'}]).length>0);
});

test('服务器读取旧数据库即使用统一规则，不要求上传或覆盖原数据库',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});
  await createInitialAdmin(db,'semester-fixture','规则测试管理员','SemesterFixture123');
  db.prepare('INSERT INTO terms(id,academic_year,name,starts_on,ends_on,config_json) VALUES(?,?,?,?,?,?)').run('legacy-term',input.academicYear,input.name,input.startsOn,input.endsOn,JSON.stringify(legacy));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({studentId:'semester-fixture',password:'SemesterFixture123'})});
  const response=await fetch(base+'/api/timetable/terms',{headers:{Cookie:login.headers.get('set-cookie').split(';')[0]}});
  assert.equal(response.status,200);const result=await response.json();
  assert.deepEqual(result.terms[0].config.calendars,term.config.calendars);
  assert.equal(JSON.parse(db.prepare('SELECT config_json FROM terms WHERE id=?').get('legacy-term').config_json).calendars.length,3);
});
