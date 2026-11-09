import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';

test('管理员删除模板保留已选课程、个人调整、卡片与作业，且其他模板继续同步',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});
  await createInitialAdmin(db,'delete-admin','管理员','TemplateDeleteFixture123');
  const password=await hashPassword('TemplateDeleteFixture123');
  for(const [id,role] of [['delete-admin-two','admin'],['delete-one','student'],['delete-two','student']])
    db.prepare('INSERT INTO users(student_id,name,role,password_hash,must_change_password) VALUES(?,?,?,?,0)').run(id,id,role,password);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,method='GET',body,cookie){
    const response=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const login=async id=>(await call('/auth/login','POST',{studentId:id,password:'TemplateDeleteFixture123'})).cookie;
  const admin=await login('delete-admin'),otherAdmin=await login('delete-admin-two'),student=await login('delete-one'),otherStudent=await login('delete-two');
  const termId=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'第一学期',startsOn:'2026-09-01',endsOn:'2027-01-31'},admin)).data.id;
  const raw=(name,day)=>({course_name:name,teacher:'老师',explicit_sessions:[{date:`2026-11-${day}`,start_time:'08:00',end_time:'10:00',room:'原教室'}]});
  assert.equal((await call('/admin/timetable/courses','POST',{termId,courses:[raw('甲课程','14'),raw('乙课程','15'),raw('丙课程','16')],acceptWarnings:true},admin)).status,201);
  const catalog=(await call('/admin/timetable/courses?termId='+termId,'GET',undefined,admin)).data;
  const a=catalog.find(c=>c.course_name==='甲课程').id,b=catalog.find(c=>c.course_name==='乙课程').id,c=catalog.find(c=>c.course_name==='丙课程').id;
  const create=async(name,courseIds)=>(await call('/admin/timetable/templates','POST',{termId,name,courseIds},admin)).data.id;
  const deletedId=await create('待删除模板',[a,b]),remainingId=await create('继续同步模板',[b,c]);
  const get=async cookie=>(await call('/timetable/'+termId,'GET',undefined,cookie)).data;
  const select=async(id,cookie)=>call('/timetable/'+termId,'POST',{source:'template',templateId:id,revision:(await get(cookie)).timetable?.revision||0,acceptWarnings:true},cookie);
  assert.equal((await select(deletedId,student)).status,200);
  assert.equal((await select(remainingId,otherStudent)).status,200);
  assert.equal((await select(deletedId,admin)).status,200);
  // Register a second subscription sharing B without creating a duplicate entry.
  const own=await get(student),ttId=own.timetable.id;
  db.prepare('INSERT INTO timetable_template_subscriptions VALUES(?,?,1)').run(ttId,remainingId);
  const shared=own.courses.find(x=>x.publicCourseId===b);
  db.prepare('INSERT INTO timetable_entry_templates VALUES(?,?)').run(shared.id,remainingId);
  const entry=own.courses.find(x=>x.publicCourseId===a);
  assert.equal((await call(`/timetable/${termId}/entries/${entry.id}`,'PATCH',{revision:own.timetable.revision,publicRevision:entry.publicRevision,sessions:entry.sessions.map(s=>({...s,room:'个人教室'}))},student)).status,200);
  const homework=await call('/admin/homework/records','POST',{termId,record:{kind:'assignment',course_name:'甲课程',teacher:'老师',title:'保留作业',content:'课程报告',targetKeys:['course:'+a],published:true}},admin);
  assert.equal(homework.status,201);
  assert.equal((await call(`/homework/records/${homework.data.id}/completion`,'POST',{revision:1,completed:true},student)).status,200);
  const before=await get(student),otherBefore=await get(otherStudent);
  const preserved=['public_courses','homework_records','homework_targets','homework_completions'].map(name=>[name,db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()]);
  const path='/admin/timetable/templates/'+deletedId;
  await t.test('拒绝学生、未确认与旧版请求，失败不改变数据',async()=>{
    const snapshot=db.prepare('SELECT * FROM timetable_entries ORDER BY id').all();
    assert.equal((await call(path,'DELETE',{revision:1,confirm:true},student)).status,403);
    assert.equal((await call(path,'DELETE',{revision:1},admin)).status,400);
    assert.equal((await call(path,'DELETE',{revision:0,confirm:true},admin)).status,409);
    assert.deepEqual(db.prepare('SELECT * FROM timetable_entries ORDER BY id').all(),snapshot);
    assert.ok(db.prepare('SELECT id FROM timetable_templates WHERE id=?').get(deletedId));
  });
  await t.test('其他管理员也可删除，课程与个人覆盖保留，旧预览不能再使用',async()=>{
    assert.equal((await call(path,'DELETE',{revision:1,confirm:true},otherAdmin)).status,200);
    assert.equal(db.prepare('SELECT id FROM timetable_templates WHERE id=?').get(deletedId),undefined);
    for(const table of ['template_courses','timetable_template_subscriptions','timetable_entry_templates'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE template_id=?`).get(deletedId).n,0);
    const after=await get(student);
    assert.deepEqual(after.courses,before.courses);
    assert.equal(after.timetable.templateId,null);assert.equal(after.timetable.templateRevision,null);
    assert.equal(after.timetable.revision,before.timetable.revision+1);
    const otherAfter=await get(otherStudent);
    assert.deepEqual({...otherAfter,serverNow:undefined},{...otherBefore,serverNow:undefined});
    assert(db.prepare('SELECT direct_source FROM timetable_entries WHERE id=?').get(entry.id).direct_source==='cards');
    assert(db.prepare('SELECT direct_source FROM timetable_entries WHERE id=?').get(shared.id).direct_source==='cards');
    assert.equal((await get(admin)).courses.length,2);
    for(const [name,rows] of preserved)assert.deepEqual(db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all(),rows);
    assert.equal((await call('/timetable/selection-preview','POST',{termId,source:'template',templateId:deletedId},student)).status,400);
    assert.equal((await select(deletedId,student)).status,400);
    assert.equal((await call(path,'DELETE',{revision:1,confirm:true},admin)).status,404);
  });
  await t.test('剩余模板移除共享课不删除保留课，已编辑课程持续保持个人内容',async()=>{
    assert.equal((await call('/admin/timetable/templates/'+remainingId,'PUT',{name:'继续同步模板',courseIds:[c],revision:1},admin)).status,200);
    const after=await get(student);assert(after.courses.some(x=>x.publicCourseId===a));assert(after.courses.some(x=>x.publicCourseId===b));
    assert.deepEqual((await get(otherStudent)).courses.map(x=>x.publicCourseId),[c]);
    const original=catalog.find(x=>x.id===a);
    assert.equal((await call('/admin/timetable/courses/'+a,'PUT',{course:{...raw('甲课程更新','14'),teacher:'新老师'},revision:original.revision,acceptWarnings:true},admin)).status,200);
    const updated=(await get(student)).courses.find(x=>x.publicCourseId===a);
    assert.equal(updated.course_name,'甲课程');assert.equal(updated.teacher,'老师');assert.equal(updated.sessions[0].room,'个人教室');
    assert.equal((await call('/homework','GET',undefined,student)).data.records.find(x=>x.id===homework.data.id).completed,true);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
});
