import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.mjs';
import { createInitialAdmin, hashPassword } from '../database.mjs';

test('浏览模板返回全部课程且不写个人课表，只保存确认的模板并拒绝过期预览', async t => {
  const { server, db } = await createApp({ databasePath: ':memory:' });
  await createInitialAdmin(db, 'browse-admin', '学委', 'BrowseAdminFixture123');
  db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run('browse-student','测试同学',await hashPassword('BrowseStudentFixture123'));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, method = 'GET', body, cookie) {
    const response = await fetch(base + '/api' + path, {method, headers:{...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const admin=(await call('/auth/login','POST',{studentId:'browse-admin',password:'BrowseAdminFixture123'})).cookie;
  const student=(await call('/auth/login','POST',{studentId:'browse-student',password:'BrowseStudentFixture123'})).cookie;
  const termId=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'秋冬学期',startsOn:'2026-09-01',endsOn:'2027-01-31'},admin)).data.id;
  const course=(name,code,day)=>({course_name:name,teaching_class_code:code,teacher:'课程老师',explicit_sessions:[{date:day,start_time:'08:00',end_time:'10:00',room:'工教二201'}]});
  const shared=course('共同课程','BROWSE-COMMON','2026-11-07');
  async function create(name,courses){
    const preview=(await call('/admin/timetable/template-preview','POST',{termId,source:'ai',courses},admin)).data;
    const result=await call('/admin/timetable/template-import','POST',{termId,source:'ai',name,courses:preview.courses,catalogVersion:preview.catalogVersion,acceptWarnings:true},admin);
    assert.equal(result.status,201);return result.data.id;
  }
  const first=await create('模板一',[shared,course('模板一独有课程','BROWSE-FIRST','2026-11-08')]);
  const second=await create('模板二',[shared,course('模板二独有课程','BROWSE-SECOND','2026-11-09')]);
  const preview = id => call('/timetable/selection-preview','POST',{termId,source:'template',templateId:id},student);
  const one=await preview(first),two=await preview(second);
  assert.equal(one.status,200);assert.equal(two.status,200);
  assert.deepEqual(one.data.courses.map(c=>c.course_name).sort(),['共同课程','模板一独有课程']);
  assert.deepEqual(two.data.courses.map(c=>c.course_name).sort(),['共同课程','模板二独有课程']);
  assert.ok(two.data.selectionVersion);assert.notEqual(one.data.selectionVersion,two.data.selectionVersion);
  for(const c of two.data.courses){assert.equal(c.teacher,'课程老师');assert.equal(c.sessions[0].room,'工教二201');assert.equal(c.sessions[0].start_time,'08:00');}
  assert.equal(db.prepare('SELECT COUNT(*) n FROM timetables').get().n,0);
  const own=two.data.courses.find(c=>c.teaching_class_code==='BROWSE-SECOND');
  const edited=await call('/admin/timetable/courses/'+own.id,'PUT',{course:{...course('模板二独有课程','BROWSE-SECOND','2026-11-09'),explicit_sessions:[{date:'2026-11-09',start_time:'08:00',end_time:'10:00',room:'更新教室'}]},revision:own.revision,acceptWarnings:true},admin);
  assert.equal(edited.status,200);
  const stale=await call('/timetable/'+termId,'POST',{source:'template',templateId:second,selectionVersion:two.data.selectionVersion,acceptWarnings:true},student);
  assert.equal(stale.status,409);assert.equal(db.prepare('SELECT COUNT(*) n FROM timetables').get().n,0);
  const beforeRename=await preview(second);
  const metadata=(await call('/admin/timetable/templates?termId='+termId,'GET',undefined,admin)).data.find(template=>template.id===second);
  db.prepare('UPDATE timetable_templates SET description=? WHERE id=?').run('历史说明字段',second);
  const rename=await call('/admin/timetable/templates/'+second,'PUT',{name:'模板二更新名称',courseIds:metadata.courseIds,revision:metadata.revision,published:true},admin);
  assert.equal(rename.status,200);assert.equal(db.prepare('SELECT description FROM timetable_templates WHERE id=?').get(second).description,'历史说明字段');
  const staleMetadata=await call('/timetable/'+termId,'POST',{source:'template',templateId:second,selectionVersion:beforeRename.data.selectionVersion,acceptWarnings:true},student);
  assert.equal(staleMetadata.status,409);assert.equal(db.prepare('SELECT COUNT(*) n FROM timetables').get().n,0);
  const current=await preview(second);
  assert.equal(current.data.templateName,'模板二更新名称');
  const saved=await call('/timetable/'+termId,'POST',{source:'template',templateId:second,selectionVersion:current.data.selectionVersion,acceptWarnings:true},student);
  assert.equal(saved.status,200);assert.equal(saved.data.timetable.templateId,second);
  assert.deepEqual(saved.data.courses.map(c=>c.course_name).sort(),['共同课程','模板二独有课程']);
  assert.equal(saved.data.courses.find(c=>c.teaching_class_code==='BROWSE-SECOND').sessions[0].room,'更新教室');
});
