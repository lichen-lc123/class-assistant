import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';

test('课程作业关联、默认发布、批量删除与密码修改',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});
  await createInitialAdmin(db,'web-admin','管理员','WebAdmin123');
  const password=await hashPassword('12345678');
  for(const name of ['a','b'])db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run(name,name,password);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;
  async function call(path,method='GET',body,cookie){const r=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login','POST',{studentId:'web-admin',password:'WebAdmin123'})).cookie;
  const a=(await call('/auth/login','POST',{studentId:'a',password:'12345678'})).cookie,b=(await call('/auth/login','POST',{studentId:'b',password:'12345678'})).cookie;
  const termId=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'第一学期'},admin)).data.id;
  for(const date of ['2026-11-14','2026-11-15'])assert.equal((await call('/admin/timetable/courses','POST',{termId,source:'manual',courses:[{course_name:'同名课程',teacher:'同一老师',explicit_sessions:[{date,start_time:'08:00',end_time:'10:00',room:'教室'}]}],acceptWarnings:true},admin)).status,201);
  const cards=(await call('/admin/timetable/courses?termId='+termId,'GET',undefined,admin)).data;
  for(const [cookie,card] of [[a,cards[0]],[b,cards[1]]])assert.equal((await call('/timetable/'+termId,'POST',{source:'cards',courseIds:[card.id],revision:0,acceptWarnings:true},cookie)).status,200);
  const aEntry=(await call('/homework/courses?termId='+termId,'GET',undefined,a)).data.courses[0];
  const bEntry=(await call('/homework/courses','GET',undefined,b)).data.courses[0];
  const record={kind:'assignment',title:'自动课程作业',course_name:'客户端错误名称',teacher:'客户端错误老师',content:'完成作业',targetKeys:['course:'+cards[0].id],autoPublish:true,published:false,attachments:[]};
  const created=await call('/admin/homework/records','POST',{termId,record},admin);assert.equal(created.status,201);
  const work=created.data;
  await t.test('默认发布根据课程身份关联，不按同名同老师串课',async()=>{
    assert.equal(work.published,true);assert.equal(work.course_name,'同名课程');assert.equal(work.teacher,'同一老师');
    assert.equal((await call('/homework/course/'+aEntry.entryId,'GET',undefined,a)).data.records.length,1);
    assert.equal((await call('/homework/course/'+bEntry.entryId,'GET',undefined,b)).data.records.length,0);
    assert.equal((await call('/homework/course/'+aEntry.entryId,'GET',undefined,b)).status,403);
    assert.equal((await call('/admin/homework/records','POST',{termId,record:{...record,targetKeys:[]}},admin)).status,400);
    const privateWork=await call('/homework/personal','POST',{termId,record:{kind:'assignment',title:'个人任务',course_entry_id:aEntry.entryId,targetKeys:[],attachments:[]}},a);assert.equal(privateWork.status,201);
    const detail=(await call('/homework/course/'+aEntry.entryId,'GET',undefined,a)).data;assert.equal(detail.records.length,2);
    const done=await call('/homework/records/'+work.id+'/completion','POST',{completed:true,revision:work.revision},a);assert.equal(done.status,200);
    assert.equal((await call('/homework/course/'+aEntry.entryId,'GET',undefined,a)).data.records.find(r=>r.id===work.id).completed,true);
    assert.ok(!(await call('/homework/summary','GET',undefined,a)).data.records.some(r=>r.id===work.id));
    const bad=await call('/admin/homework/batch-delete','POST',{termId,confirm:true,items:[{id:work.id,revision:work.revision},{id:privateWork.data.id,revision:privateWork.data.revision}]},admin);assert.equal(bad.status,403);
    assert.ok(db.prepare('SELECT id FROM homework_records WHERE id=?').get(work.id));
  });
  await t.test('批量删除先校验所有记录；无权或过期时整批不删除',async()=>{
    const second=(await call('/admin/homework/records','POST',{termId,record:{...record,title:'另一个作业'}},admin)).data;
    const items=[{id:work.id,revision:work.revision},{id:second.id,revision:second.revision}];
    assert.equal((await call('/admin/homework/batch-delete','POST',{termId,items,confirm:true},a)).status,403);
    assert.equal((await call('/admin/homework/batch-delete','POST',{termId,items,confirm:false},admin)).status,400);
    assert.equal((await call('/admin/homework/batch-delete','POST',{termId,items:[items[0],{...items[1],revision:99}],confirm:true},admin)).status,409);
    assert.ok(db.prepare('SELECT id FROM homework_records WHERE id=?').get(work.id));
    assert.equal((await call('/admin/homework/batch-delete','POST',{termId,items,confirm:true},admin)).data.deleted,2);
    assert.equal((await call('/homework/course/'+aEntry.entryId,'GET',undefined,a)).data.records.some(r=>r.id===work.id),false);
  });
  await t.test('新密码规则与旧数字密码登录兼容，修改后旧会话失效',async()=>{
    for(const newPassword of ['123456789','abcdefgh','abc123','abc12345 '+'a','A1'+'x'.repeat(31)])assert.equal((await call('/auth/password','POST',{oldPassword:'12345678',newPassword},a)).status,400);
    assert.equal((await call('/auth/password','POST',{oldPassword:'wrong',newPassword:'BetterPass123'},a)).status,400);
    const updated=await call('/auth/password','POST',{oldPassword:'12345678',newPassword:'BetterPass123'},a);assert.equal(updated.status,200);
    assert.equal((await call('/auth/me','GET',undefined,a)).status,401);
    assert.equal((await call('/auth/me','GET',undefined,updated.cookie)).status,200);
  });
});
