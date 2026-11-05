import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';
import {initTimetableSchema} from '../timetable-schema.mjs';

const course=(name,code,date)=>({course_name:name,course_code:'CODE-'+code,teaching_class_code:code,teacher:'老师甲',explicit_sessions:[{date,start_time:'08:00',end_time:'10:00',room:'教室甲'}]});
test('不同管理员不能重复导入整套模板，部分重合仍复用课程卡片',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});
  await createInitialAdmin(db,'duplicate-admin-a','甲管理员','DuplicateAdmin123');
  db.prepare('INSERT INTO users(student_id,name,role,password_hash,must_change_password) VALUES(?,?,?,?,0)').run('duplicate-admin-b','乙管理员','admin',await hashPassword('DuplicateAdmin123'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  async function call(path,body,cookie){const response=await fetch(base+'/api'+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const aCookie=(await call('/auth/login',{studentId:'duplicate-admin-a',password:'DuplicateAdmin123'})).cookie;
  const bCookie=(await call('/auth/login',{studentId:'duplicate-admin-b',password:'DuplicateAdmin123'})).cookie;
  const adminA=db.prepare('SELECT id FROM users WHERE student_id=?').get('duplicate-admin-a').id;
  const termId=(await call('/admin/timetable/terms',{academicYear:'2026-2027',name:'第一学期',startsOn:'2026-09-01',endsOn:'2027-01-31'},aCookie)).data.id;
  const a=course('工程经济学','CLASS-A','2026-11-07'),b=course('系统工程','CLASS-B','2026-11-08'),c=course('管理数学','CLASS-C','2026-11-09');
  const preview=(courses,cookie=aCookie,extra={})=>call('/admin/timetable/template-preview',{termId,source:'ai',courses,...extra},cookie);
  const save=(name,p,cookie=aCookie,extra={})=>call('/admin/timetable/template-import',{termId,source:'ai',name,courses:p.courses,catalogVersion:p.catalogVersion,acceptWarnings:true,...extra},cookie);
  assert.equal((await call('/admin/timetable/courses',{termId,source:'ai',courses:[a,b],generateCards:true,acceptWarnings:true},aCookie)).status,201);
  const pendingB=(await preview([b,a],bCookie)).data;
  const firstPreview=(await preview([a,b])).data,first=await save('甲同学课表',firstPreview);
  assert.equal(first.status,201);
  assert.equal(db.prepare('SELECT created_by FROM timetable_templates WHERE id=?').get(first.data.id).created_by,adminA);

  await t.test('AI及Excel预览均拒绝整套重复，忽略课程顺序、模板名和来源说明',async()=>{
    for(const source of ['ai','excel']){
      const result=await preview([{...b,source_rows:[{source:'另一个文件',row:9,raw:'无关排版'}]},a],bCookie,{source});
      assert.equal(result.status,409);assert.match(result.data.message,/导入失败.*甲同学课表.*完全一致/);
    }
    const rawText='【课表开始】'+JSON.stringify({schema_version:'timetable.v1',courses:[a,b]})+'【课表结束】';
    assert.equal((await preview(undefined,bCookie,{text:rawText})).status,409);
  });
  await t.test('保存时重新检查，其他管理员刚导入但卡片版本未变也会拒绝，不能伪造创建人',async()=>{
    assert.equal((await preview([a,b])).data.catalogVersion,pendingB.catalogVersion);
    const before=db.prepare('SELECT * FROM timetable_templates ORDER BY id').all();
    const result=await save('另一个名称',pendingB,bCookie,{created_by:adminA,createdBy:adminA,published:false});
    assert.equal(result.status,409);assert.match(result.data.message,/完全一致/);
    assert.deepEqual(db.prepare('SELECT * FROM timetable_templates ORDER BY id').all(),before);
    assert.equal(db.prepare('SELECT count(*) n FROM public_courses').get().n,2);
    const ids=db.prepare('SELECT id FROM public_courses ORDER BY id').all().map(row=>row.id);
    assert.equal((await call('/admin/timetable/templates',{termId,name:'直接创建也重复',courseIds:ids},bCookie)).status,409);
  });
  await t.test('部分课程重合可导入并复用卡片，同名异班不误判',async()=>{
    const next=(await preview([a,c],bCookie)).data,created=await save('乙同学课表',next,bCookie);
    assert.equal(created.status,201);assert.equal(created.data.reused,1);assert.equal(created.data.created,1);
    const otherClass={...a,teaching_class_code:'CLASS-D'};
    const other=(await preview([otherClass,b],bCookie)).data;
    assert.equal((await save('不同上课班',other,bCookie)).status,201);
  });
  await t.test('同一管理员原有多模板能力保留，历史未知创建人的重复模板也受保护',async()=>{
    const own=(await preview([a,b])).data;
    assert.equal((await save('甲的另一个模板名称',own)).status,201);
    db.prepare('UPDATE timetable_templates SET created_by=NULL WHERE id=?').run(first.data.id);
    assert.equal((await preview([a,b])).status,409);
  });
  await t.test('不同学期分别判断，不把上学期模板当成本学期重复',async()=>{
    const nextTerm=(await call('/admin/timetable/terms',{academicYear:'2026-2027',name:'第二学期',startsOn:'2027-02-01',endsOn:'2027-06-30'},aCookie)).data.id;
    const p=(await preview([a,b],bCookie,{termId:nextTerm})).data;
    assert.equal((await save('下学期模板',p,bCookie,{termId:nextTerm})).status,201);
  });
});

test('模板创建人字段可迁移旧库，历史模板及成员保留且重复启动安全',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1)');
  initTimetableSchema(db);
  db.exec("INSERT INTO terms(id,academic_year,name) VALUES('term','2026-2027','第一学期');INSERT INTO public_courses(id,term_id,payload_json) VALUES('course','term','{}');INSERT INTO timetable_templates(id,term_id,name) VALUES('template','term','旧模板');INSERT INTO template_courses VALUES('template','course');ALTER TABLE timetable_templates DROP COLUMN created_by;");
  initTimetableSchema(db);initTimetableSchema(db);
  assert.equal(db.prepare('SELECT name,created_by FROM timetable_templates').get().name,'旧模板');
  assert.equal(db.prepare('SELECT created_by FROM timetable_templates').get().created_by,null);
  assert.equal(db.prepare('SELECT count(*) n FROM template_courses').get().n,1);
  db.prepare('UPDATE timetable_templates SET created_by=1').run();db.exec('DELETE FROM users WHERE id=1');
  assert.equal(db.prepare('SELECT created_by FROM timetable_templates').get().created_by,null);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
});
