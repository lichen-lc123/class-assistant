import {courseTarget} from './fixtures/course-target.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';
import {addDays,todayShanghai} from '../schedule.mjs';
import {timetableService} from '../timetable.mjs';

test('模板成员与卡片更新同步到已选用户，保留个人安排并更新作业权限',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});
  await createInitialAdmin(db,'sync-admin','学委','SyncAdminFixture123');
  const password=await hashPassword('SyncStudentFixture123');
  for(const id of ['sync-template','sync-cards','sync-other','sync-private'])db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run(id,id,password);
  await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,method='GET',body,cookie){const response=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login','POST',{studentId:'sync-admin',password:'SyncAdminFixture123'})).cookie;
  const cookies={};for(const id of ['template','cards','other','private'])cookies[id]=(await call('/auth/login','POST',{studentId:'sync-'+id,password:'SyncStudentFixture123'})).cookie;
  const date=addDays(todayShanghai(),20),term={academicYear:'2026-2027',name:'第一学期',startsOn:addDays(date,-30),endsOn:addDays(date,120)};
  const termId=(await call('/admin/timetable/terms','POST',term,admin)).data.id;
  const course=(name,code,offset=0)=>({course_name:name,teaching_class_code:code,teacher:'原老师',explicit_sessions:[{date:addDays(date,offset),start_time:'08:00',end_time:'10:00',room:'原教室'}]});
  const initial=[course('保留课程','SYNC-A'),course('移除课程','SYNC-B',1),course('新增课程','SYNC-C',2)];
  assert.equal((await call('/admin/timetable/courses','POST',{termId,courses:initial,acceptWarnings:true},admin)).status,201);
  const courses=(await call('/admin/timetable/courses?termId='+termId,'GET',undefined,admin)).data;
  const ids=Object.fromEntries(courses.map(c=>[c.teaching_class_code,c.id])),a=ids['SYNC-A'],b=ids['SYNC-B'],c=ids['SYNC-C'];
  const templateId=(await call('/admin/timetable/templates','POST',{termId,name:'同步模板',courseIds:[a,b]},admin)).data.id;
  const otherId=(await call('/admin/timetable/templates','POST',{termId,name:'其他模板',courseIds:[b]},admin)).data.id;
  const get=cookie=>call('/timetable/'+termId,'GET',undefined,cookie);
  let own,cardOwn,retainedEntry,homeworkB,homeworkC;

  await t.test('模板、卡片、独立模板和个人导入各自保存',async()=>{
    own=(await call('/timetable/'+termId,'POST',{source:'template',templateId,acceptWarnings:true},cookies.template)).data;
    cardOwn=(await call('/timetable/'+termId,'POST',{source:'cards',courseIds:[a,b],acceptWarnings:true},cookies.cards)).data;
    assert.equal((await call('/timetable/'+termId,'POST',{source:'template',templateId:otherId,acceptWarnings:true},cookies.other)).status,200);
    assert.equal((await call('/timetable/'+termId,'POST',{source:'ai',courses:[initial[0]],acceptWarnings:true},cookies.private)).status,200);
    assert.equal((await call('/timetable/'+termId,'POST',{source:'template',templateId,acceptWarnings:true},admin)).status,200);
    retainedEntry=own.courses.find(x=>x.publicCourseId===a);
    const edited=await call(`/timetable/${termId}/entries/${retainedEntry.id}`,'PATCH',{revision:own.timetable.revision,publicRevision:retainedEntry.publicRevision,sessions:retainedEntry.sessions.map(s=>({...s,room:'我的教室'}))},cookies.template);
    assert.equal(edited.status,200);own=edited.data;
    for(const [code,name]of [['SYNC-B','移除课程'],['SYNC-C','新增课程']]){
      const result=await call('/admin/homework/records','POST',{termId,record:{kind:'assignment',course_name:name,teacher:'原老师',title:name+'作业',content:'完成课程练习',targetKeys:[courseTarget(db,code)],published:true}},admin);assert.equal(result.status,201);
      if(code==='SYNC-B')homeworkB=result.data.id;else homeworkC=result.data.id;
    }
  });
  await t.test('管理员增删模板课程立即同步所有选用账号，卡片组合和其他模板不变',async()=>{
    const template=(await call('/admin/timetable/templates?termId='+termId,'GET',undefined,admin)).data.find(x=>x.id===templateId);
    const changed=await call('/admin/timetable/templates/'+templateId,'PUT',{name:'同步模板新版',courseIds:[a,c],revision:template.revision},admin);assert.equal(changed.status,200);
    // Membership is already updated before any student refresh or permission check.
    const userId=db.prepare('SELECT id FROM users WHERE student_id=?').get('sync-template').id;
    assert.deepEqual(db.prepare('SELECT e.course_id id FROM timetable_entries e JOIN timetables tt ON tt.id=e.timetable_id WHERE tt.user_id=?').all(userId).map(x=>x.id).sort(),[a,c].sort());
    const fresh=(await get(cookies.template)).data;assert.deepEqual(fresh.courses.map(x=>x.publicCourseId).sort(),[a,c].sort());assert.ok(fresh.timetable.revision>own.timetable.revision);
    assert.equal(fresh.courses.find(x=>x.publicCourseId===a).id,retainedEntry.id);assert.equal(fresh.courses.find(x=>x.publicCourseId===a).sessions[0].room,'我的教室');
    assert.deepEqual((await get(admin)).data.courses.map(x=>x.publicCourseId).sort(),[a,c].sort());
    assert.deepEqual((await get(cookies.cards)).data.courses.map(x=>x.publicCourseId).sort(),[a,b].sort());
    assert.deepEqual((await get(cookies.other)).data.courses.map(x=>x.publicCourseId),[b]);
    const stale=await call(`/timetable/${termId}/entries/${retainedEntry.id}`,'DELETE',{revision:own.timetable.revision},cookies.template);assert.equal(stale.status,409);
    const homework=(await call('/homework?termId='+termId,'GET',undefined,cookies.template)).data;
    assert.ok(JSON.stringify(homework).includes(homeworkC));assert.ok(!JSON.stringify(homework).includes(homeworkB));
    assert.equal((await call('/homework/records/'+homeworkB,'GET',undefined,cookies.template)).status,403);
    const dashboard=(await call('/timetable/dashboard','GET',undefined,cookies.template)).data;
    assert.deepEqual(dashboard.days.flatMap(day=>day.lessons.map(x=>x.courseName)).sort(),['保留课程','新增课程']);own=fresh;
  });
  await t.test('修改卡片名称老师时间地点后同步，个人教室优先且自行导入仍独立',async()=>{
    const old=(await call('/admin/timetable/courses?termId='+termId,'GET',undefined,admin)).data.find(x=>x.id===a);
    const updated={...initial[0],course_name:'更新课程名',teacher:'更新老师',explicit_sessions:[{date:addDays(date,3),start_time:'13:00',end_time:'15:00',room:'新公共教室'}]};
    assert.equal((await call('/admin/timetable/courses/'+a,'PUT',{course:updated,revision:old.revision,acceptWarnings:true},admin)).status,200);
    const template=(await get(cookies.template)).data.courses.find(x=>x.publicCourseId===a),card=(await get(cookies.cards)).data.courses.find(x=>x.publicCourseId===a);
    for(const entry of [template,card]){assert.equal(entry.course_name,'更新课程名');assert.equal(entry.teacher,'更新老师');assert.equal(entry.sessions[0].date,addDays(date,3));assert.equal(entry.sessions[0].start_time,'13:00');}
    assert.equal(template.sessions[0].room,'我的教室');assert.equal(card.sessions[0].room,'新公共教室');
    const privateCourse=(await get(cookies.private)).data.courses[0];assert.equal(privateCourse.course_name,'保留课程');assert.equal(privateCourse.sessions[0].room,'原教室');
    // Old card edits cannot overwrite a newly changed shared course.
    const previous=cardOwn.courses.find(x=>x.publicCourseId===a);
    assert.equal((await call(`/timetable/${termId}/entries/${previous.id}`,'PATCH',{revision:cardOwn.timetable.revision,publicRevision:previous.publicRevision,sessions:previous.sessions},cookies.cards)).status,409);
  });
  await t.test('越权、旧版本及跨学期更新不改变模板或学生选课',async()=>{
    const template=(await call('/admin/timetable/templates?termId='+termId,'GET',undefined,admin)).data.find(x=>x.id===templateId);
    const before=db.prepare('SELECT * FROM timetable_entries ORDER BY id').all();
    const payload={name:template.name,courseIds:[b],revision:template.revision};
    assert.equal((await call('/admin/timetable/templates/'+templateId,'PUT',payload,cookies.template)).status,403);
    assert.equal((await call('/admin/timetable/templates/'+templateId,'PUT',{...payload,revision:0},admin)).status,409);
    const next=(await call('/admin/timetable/terms','POST',{...term,name:'第二学期'},admin)).data.id;
    assert.equal((await call('/admin/timetable/courses','POST',{termId:next,courses:[initial[2]],acceptWarnings:true},admin)).status,201);
    const foreign=(await call('/admin/timetable/courses?termId='+next,'GET',undefined,admin)).data[0].id;
    assert.equal((await call('/admin/timetable/templates/'+templateId,'PUT',{...payload,courseIds:[foreign]},admin)).status,400);
    assert.deepEqual(db.prepare('SELECT * FROM timetable_entries ORDER BY id').all(),before);
  });
  await t.test('历史模板版本在读取时补同步，重复读取不改版本，支持外层事务回滚',async()=>{
    const userId=db.prepare('SELECT id FROM users WHERE student_id=?').get('sync-template').id;
    const tt=db.prepare('SELECT * FROM timetables WHERE user_id=? AND term_id=?').get(userId,termId);
    const simulateOld=()=>{db.prepare('DELETE FROM timetable_entries WHERE timetable_id=? AND course_id=?').run(tt.id,c);db.prepare('UPDATE timetable_template_subscriptions SET template_revision=0 WHERE timetable_id=?').run(tt.id);};
    simulateOld();const fresh=(await get(cookies.template)).data;assert.deepEqual(fresh.courses.map(x=>x.publicCourseId).sort(),[a,c].sort());
    const unchanged=(await get(cookies.template)).data;assert.equal(unchanged.timetable.revision,fresh.timetable.revision);
    db.exec('BEGIN IMMEDIATE');
    try{simulateOld();const nested=timetableService(db).get(userId,termId);assert.equal(db.isTransaction,true);assert.equal(nested.courses.length,2);}finally{db.exec('ROLLBACK');}
    assert.equal((await get(cookies.template)).data.timetable.revision,fresh.timetable.revision);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  });
});
