import {courseTarget} from './fixtures/course-target.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';
import {initHomeworkSchema} from '../homework-schema.mjs';

test('个人作业仅从本人课表选择并自动带出教师，可编辑完成排序且私人资料隔离',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});await createInitialAdmin(db,'personal-admin','学委','PersonalAdmin123');const pass=await hashPassword('PersonalStudent123');for(const id of ['personal-one','personal-two'])db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run(id,id,pass);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
  async function call(path,method='GET',body,cookie){const r=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login','POST',{studentId:'personal-admin',password:'PersonalAdmin123'})).cookie,one=(await call('/auth/login','POST',{studentId:'personal-one',password:'PersonalStudent123'})).cookie,two=(await call('/auth/login','POST',{studentId:'personal-two',password:'PersonalStudent123'})).cookie;
  const termId=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'秋冬学期',startsOn:'2026-09-01',endsOn:'2027-01-31'},admin)).data.id;
  const course={course_name:'个人所选课程',teacher:'本人课程老师',explicit_sessions:[{date:'2026-11-13',start_time:'08:00',end_time:'10:00',room:'教室'}]};
  assert.equal((await call('/homework/personal','POST',{termId,record:{kind:'assignment',title:'尚未导入课程'}},one)).status,400);
  const addCourse=async cookie=>(await call('/timetable/'+termId,'POST',{source:'ai',courses:[course],acceptWarnings:true},cookie)).data.courses[0].id;
  const courseEntryId=await addCourse(one),adminEntryId=await addCourse(admin);
  const input={kind:'assignment',course_entry_id:courseEntryId,course_name:course.course_name,teacher:course.teacher,title:'个人阅读报告',content:'',due_date:'2026-11-20',due_time:'18:00',targetKeys:[],attachments:[]};
  assert.equal((await call('/homework/personal','POST',{termId,record:input})).status,401);
  assert.equal((await call('/homework/personal','POST',{termId,record:{...input,title:''}},one)).status,400);
  assert.equal((await call('/homework/personal','POST',{termId,record:{...input,targetKeys:['code:CLASS-A']}},one)).status,400);
  assert.equal((await call('/homework/personal','POST',{termId,record:{...input,attachments:[{assetId:'0'.repeat(64),field:'content'}]}},one)).status,400);
  await t.test('未选择、手填名称、其他人的选课与跨学期选课均拒绝',async()=>{
    assert.equal((await call('/homework/personal','POST',{termId,record:{...input,course_entry_id:null}},one)).status,400);
    assert.equal((await call('/homework/personal','POST',{termId,record:{...input,course_entry_id:adminEntryId}},one)).status,400);
    assert.equal((await call('/homework/personal','POST',{termId,record:input},two)).status,400);
    assert.equal((await call('/homework/personal','POST',{termId,record:input},admin)).status,400);
    const next=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'第二学期'},admin)).data.id;
    assert.equal((await call('/homework/personal','POST',{termId:next,record:input},one)).status,400);
  });
  const saved=await call('/homework/personal','POST',{termId,record:{...input,course_name:'伪造课程',teacher:'伪造老师',owner_id:999,sourceType:'class',canEdit:false}},one);assert.equal(saved.status,201);let own=saved.data;assert.equal(own.sourceType,'personal');assert.equal(own.canEdit,true);assert.equal(own.course_name,course.course_name);assert.equal(own.teacher,course.teacher);assert.equal(own.course_entry_id,courseEntryId);assert.equal(own.revision,1);
  initHomeworkSchema(db);assert.equal(db.prepare('SELECT COUNT(*) n FROM homework_records').get().n,1);
  assert.equal((await call('/homework','GET',undefined,one)).data.records.length,1);for(const cookie of [two,admin])assert.equal((await call('/homework?userId=personal-one','GET',undefined,cookie)).data.records.length,0);
  assert.equal((await call('/admin/homework?termId='+termId,'GET',undefined,admin)).data.records.length,0);
  const img=Buffer.from('89504e470d0a1a0a','hex'),assetId=createHash('sha256').update(img).digest('hex');db.prepare('INSERT INTO homework_assets VALUES(?,?,?)').run(assetId,'image/png',img);db.prepare('INSERT INTO homework_attachments VALUES(?,?,?,?)').run(own.id,assetId,'content','测试图片');const imageUrl=base+'/api/homework/assets/'+assetId+'?recordId='+own.id;
  assert.equal((await fetch(imageUrl,{headers:{Cookie:one}})).status,200);for(const cookie of [two,admin])assert.equal((await fetch(imageUrl,{headers:{Cookie:cookie}})).status,403);
  const updates={revision:1,record:{...input,title:'个人报告修订'}};
  for(const cookie of [two,admin]){assert.equal((await call('/homework/personal/'+own.id,'PUT',updates,cookie)).status,403);assert.equal((await call('/homework/personal/'+own.id,'DELETE',{revision:1,confirm:true},cookie)).status,403);}
  assert.equal((await call('/admin/homework/records/'+own.id,'PUT',updates,admin)).status,403);assert.equal((await call('/admin/homework/records/'+own.id,'DELETE',{revision:1,confirm:true},admin)).status,403);
  const completion=await call('/homework/records/'+own.id+'/completion','POST',{revision:1,completed:true},one);assert.equal(completion.data.completed,true);assert.equal((await call('/homework/summary','GET',undefined,one)).data.pendingCount,0);
  const edited=await call('/homework/personal/'+own.id,'PUT',updates,one);assert.equal(edited.status,200);own=edited.data;assert.equal(own.revision,2);assert.equal(own.completed,false);assert.equal(own.needsReconfirm,true);assert.equal((await call('/homework/personal/'+own.id,'PUT',updates,one)).status,409);
  assert.equal((await call('/homework/records/'+own.id+'/preferences','PUT',{revision:2,priority:'high',planned_date:'2026-11-06',planned_time:'20:00'},one)).status,200);
  const summary=(await call('/homework/summary','GET',undefined,one)).data;assert.equal(summary.pendingCount,1);assert.equal(summary.records[0].priority,'high');assert.equal(summary.records[0].due_date,'2026-11-20');assert.equal(summary.records[0].planned_date,'2026-11-06');
  assert.equal((await call('/admin/timetable/courses','POST',{termId,source:'manual',courses:[{course_name:'课程',teacher:'老师',teaching_class_code:'CLASS-A',explicit_sessions:[{date:'2026-11-14',start_time:'08:00',end_time:'10:00',room:'教室'}]}],acceptWarnings:true},admin)).status,201);
  const publicInput={...input,title:'学委作业',course_name:'课程',teacher:'老师',content:'公共内容',targetKeys:[courseTarget(db,'CLASS-A')],published:true};const shared=await call('/admin/homework/records','POST',{termId,record:publicInput},admin);assert.equal(shared.status,201);assert.equal((await call('/homework/personal/'+shared.data.id,'PUT',{revision:1,record:input},one)).status,403);
  const adminOwn=await call('/homework/personal','POST',{termId,record:{...input,course_entry_id:adminEntryId}},admin);assert.equal(adminOwn.status,201);assert.equal((await call('/admin/homework?termId='+termId,'GET',undefined,admin)).data.records.length,1);assert.equal((await call('/homework','GET',undefined,admin)).data.records[0].id,adminOwn.data.id);
  assert.equal((await call('/homework/personal/'+own.id,'DELETE',{revision:1,confirm:true},one)).status,409);assert.equal((await call('/homework/personal/'+own.id,'DELETE',{revision:2},one)).status,400);assert.equal((await call('/homework/personal/'+own.id,'DELETE',{revision:2,confirm:true},one)).status,200);assert.equal(db.prepare('SELECT COUNT(*) n FROM homework_preferences WHERE record_id=?').get(own.id).n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM homework_completions WHERE record_id=?').get(own.id).n,0);
  const again=await call('/homework/personal','POST',{termId,record:input},one);assert.equal(again.status,201);
  await t.test('课程移出课表后旧个人作业保留并可编辑，不能再据此新建',async()=>{
    const tt=(await call('/timetable/'+termId,'GET',undefined,one)).data;
    assert.equal((await call(`/timetable/${termId}/entries/${courseEntryId}`,'DELETE',{revision:tt.timetable.revision},one)).status,200);
    assert.equal((await call('/homework/personal','POST',{termId,record:input},one)).status,400);
    assert.equal((await call('/homework/personal/'+again.data.id,'PUT',{revision:1,record:{...input,title:'课程移除后仍可维护'}},one)).status,200);
    const visible=(await call('/homework','GET',undefined,one)).data.records.find(r=>r.id===again.data.id);
    assert.equal(visible.course_name,course.course_name);assert.equal(visible.teacher,course.teacher);
  });
  await t.test('历史未关联课程的个人作业仍可维护，但不能手填新课程绕过限制',async()=>{
    const owner=db.prepare("SELECT id FROM users WHERE student_id='personal-one'").get().id;
    const legacy={kind:'assignment',title:'历史个人事项',course_name:'',teacher:'',targetKeys:[],attachments:[]};
    db.prepare('INSERT INTO homework_records(id,term_id,source_key,kind,title,payload_json,published,owner_id) VALUES(?,?,?,?,?,?,1,?)').run('legacy-private-work',termId,'personal:legacy','assignment',legacy.title,JSON.stringify(legacy),owner);
    const edit=await call('/homework/personal/legacy-private-work','PUT',{revision:1,record:{...legacy,title:'历史事项修订'}},one);
    assert.equal(edit.status,200);assert.equal(edit.data.course_name,'');
    assert.equal((await call('/homework/personal/legacy-private-work','PUT',{revision:2,record:{...legacy,course_name:'手写陌生课程'}},one)).status,400);
    assert.equal((await call('/homework/personal/legacy-private-work','PUT',{revision:2,record:{...legacy,course_entry_id:adminEntryId}},one)).status,400);
  });
  db.prepare("DELETE FROM users WHERE student_id='personal-one'").run();assert.equal(db.prepare('SELECT id FROM homework_records WHERE id=?').get(again.data.id),undefined);assert.ok(db.prepare('SELECT id FROM homework_records WHERE id=?').get(shared.data.id));
});
