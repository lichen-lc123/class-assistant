import {test} from 'node:test';
import assert from 'node:assert/strict';
import {upcomingClassDays} from '../dashboard.mjs';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';
import {todayShanghai,addDays} from '../schedule.mjs';
const session=(date,time='13:25')=>({date,start_time:time,end_time:'17:00',start:date+'T'+time+':00+08:00',end:date+'T17:00:00+08:00',room:'工教二307',kind:'lecture'});
const table=(courses,name='秋冬学期')=>({term:{name,academicYear:'2026-2027'},courses});
test('工作台按未来三个有课日期分组，排除今天并跳过无课日',()=>{
  const dates=['2026-11-04','2026-11-06','2026-11-07','2026-11-08','2026-11-10'];
  const t=table([{id:'a',course_name:'工程经济学',teacher:'顾老师',sessions:dates.map(d=>session(d))},{id:'b',course_name:'上午课程',sessions:[session('2026-11-06','08:00')]}]);
  const wed=upcomingClassDays([t],'2026-11-04');assert.deepEqual(wed.days.map(d=>d.date),dates.slice(1,4));assert.deepEqual(wed.days.map(d=>d.daysUntil),[2,3,4]);assert.equal(wed.days[0].lessons.length,2);assert.equal(wed.days[0].lessons[0].courseName,'上午课程');
  assert.deepEqual(upcomingClassDays([t],'2026-11-05').days.map(d=>d.date),dates.slice(1,4));
  assert.deepEqual(upcomingClassDays([t],'2026-11-06').days.map(d=>d.date),['2026-11-07','2026-11-08','2026-11-10']);
});
test('倒计时跨年、闰日正确，课次保留明确编号，多个学期共同筛选',()=>{
  const a=table([{id:'a',course_name:'甲',sessions:[{...session('2026-12-31'),lesson_number:8}]}]);
  const b=table([{id:'b',course_name:'乙',sessions:[session('2027-01-02'),session('2027-01-03')]}],'冬学期');
  const r=upcomingClassDays([b,a],'2026-12-30');assert.deepEqual(r.days.map(d=>d.daysUntil),[1,3,4]);assert.equal(r.days[0].lessons[0].lessonNumber,8);assert.equal(r.days[1].lessons[0].termName,'冬学期');
  const leap=upcomingClassDays([table([{id:'x',course_name:'课',sessions:[session('2028-03-01')]}])],'2028-02-28');assert.equal(leap.days[0].daysUntil,2);
});
test('没有足够上课日时仅返回实际日期，待安排课程不编造日期',()=>{
  const r=upcomingClassDays([table([{id:'p',course_name:'待通知',sessions:[]},{id:'q',course_name:'旧课',sessions:[session('2026-11-03')]},{id:'r',course_name:'明天课',sessions:[session('2026-11-05')]}])],'2026-11-04');assert.equal(r.days.length,1);assert.equal(r.pendingCourseCount,1);assert.equal(upcomingClassDays([],'2026-11-04').days.length,0);
});
test('工作台仅读取本人课程，支持跨学期，普通用户和管理员数据相互隔离',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});await createInitialAdmin(db,'dash-admin','学委','DashboardAdmin123');
  const password=await hashPassword('DashboardStudent123');for(const id of ['dash-one','dash-two'])db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run(id,id,password);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,method='GET',body,cookie){const response=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json',Origin:base}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login','POST',{studentId:'dash-admin',password:'DashboardAdmin123'})).cookie;
  const one=(await call('/auth/login','POST',{studentId:'dash-one',password:'DashboardStudent123'})).cookie;
  const two=(await call('/auth/login','POST',{studentId:'dash-two',password:'DashboardStudent123'})).cookie;
  const today=todayShanghai(),year=Number(today.slice(0,4)),academicYear=year+'-'+(year+1);
  const a=await call('/admin/timetable/terms','POST',{academicYear,name:'当前学期',startsOn:addDays(today,-10),endsOn:addDays(today,30)},admin);assert.equal(a.status,201);
  const b=await call('/admin/timetable/terms','POST',{academicYear,name:'后续学期',startsOn:addDays(today,31),endsOn:addDays(today,120)},admin);assert.equal(b.status,201);
  const courses=[{course_name:'我的课程',explicit_sessions:[0,2,3,4,6].map(n=>session(addDays(today,n)))},{course_name:'上午课程',explicit_sessions:[{...session(addDays(today,2),'08:00'),end_time:'10:00'}]},{course_name:'待通知课程'}];
  const personal=await call(`/timetable/${a.data.id}`,'POST',{source:'ai',courses,acceptWarnings:true,revision:0},one);assert.equal(personal.status,200);
  assert.equal((await call(`/timetable/${b.data.id}`,'POST',{source:'ai',courses:[{course_name:'下学期课程',explicit_sessions:[session(addDays(today,35))]}],acceptWarnings:true,revision:0},one)).status,200);
  assert.equal((await call(`/timetable/${a.data.id}`,'POST',{source:'ai',courses:[{course_name:'别人的课程',explicit_sessions:[session(addDays(today,1))]}],acceptWarnings:true,revision:0},two)).status,200);
  assert.equal((await call('/timetable/dashboard')).status,401);
  const r=await call('/timetable/dashboard?userId=dash-two','GET',undefined,one);assert.equal(r.status,200);assert.deepEqual(r.data.days.map(d=>d.daysUntil),[2,3,4]);assert.equal(r.data.days[0].lessons.length,2);assert.equal(r.data.pendingCourseCount,1);assert.ok(!JSON.stringify(r.data).includes('别人的课程'));
  assert.equal((await call('/timetable/dashboard','GET',undefined,two)).data.days[0].daysUntil,1);
  assert.equal((await call('/timetable/dashboard','GET',undefined,admin)).data.days.length,0);
  assert.equal((await call(`/timetable/${a.data.id}`,'DELETE',{confirm:true,revision:personal.data.timetable.revision},one)).status,200);
  const future=await call('/timetable/dashboard','GET',undefined,one);assert.equal(future.data.days.length,1);assert.equal(future.data.days[0].daysUntil,35);assert.equal(future.data.days[0].lessons[0].courseName,'下学期课程');
});
