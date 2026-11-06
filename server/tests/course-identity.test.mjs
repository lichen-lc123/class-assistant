import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';
import {courseIdentity} from '../course-identity.mjs';
import {initTimetableSchema} from '../timetable-schema.mjs';
import {initHomeworkSchema} from '../homework-schema.mjs';
import {importSaveIssue} from '../../src/timetable/import-save.ts';

const term={id:'identity-term',academicYear:'2026-2027',name:'第一学期',config:{calendars:[],periods:[]}};
const lesson=(date='2026-11-14')=>({date,start_time:'08:00',end_time:'10:00',room:'教室甲'});
const course={course_name:'工程经济学',teacher:'甲老师',explicit_sessions:[lesson()]};
test('课程身份只使用同学期名称、教师和完整具体上课时间，不依赖班号、课程编号或教室',()=>{
  const key=courseIdentity(course,term);assert.ok(key);
  assert.equal(courseIdentity({...course,course_name:' 工程 经济学 ',teacher:'甲 老师',teaching_class_code:'任意旧班号',course_code:'不同课程编号',explicit_sessions:[{...lesson(),room:'另一教室'}]},term),key);
  for(const other of [{...course,teacher:'乙老师'},{...course,explicit_sessions:[lesson('2026-11-15')]},{...course,explicit_sessions:[{...lesson(),start_time:'09:00'}]}])assert.notEqual(courseIdentity(other,term),key);
  assert.notEqual(courseIdentity(course,{...term,id:'other-term'}),key);
  assert.equal(courseIdentity({...course,teacher:''},term),null);
  assert.equal(courseIdentity({...course,explicit_sessions:[]},term),null);
});
test('保存课程模板缺少必要步骤时给出具体提示，完成核对后可保存',()=>{
  const data={admin:true,name:'模板',preview:{courses:[course]},accepted:true};
  assert.equal(importSaveIssue(data),null);
  assert.equal(importSaveIssue({...data,name:''}).target,'name');
  assert.equal(importSaveIssue({...data,preview:null}).target,'preview');
  assert.equal(importSaveIssue({...data,accepted:false}).target,'confirmation');
  assert.match(importSaveIssue({...data,preview:{courses:[],importBlocked:true,importError:'重复时段'}}).message,/重复时段/);
});
test('无班号的AI导入自动关联正确课程，教师或具体日期不同的作业严格隔离',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});await createInitialAdmin(db,'identity-admin','管理员','IdentityAdmin123');
  const password=await hashPassword('IdentityStudent123');for(const id of ['identity-one','identity-two','identity-three'])db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run(id,id,password);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
  async function call(path,body,cookie){const response=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{...(body?{Origin:base,'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login',{studentId:'identity-admin',password:'IdentityAdmin123'})).cookie;
  const cookies=await Promise.all(['identity-one','identity-two','identity-three'].map(async studentId=>(await call('/auth/login',{studentId,password:'IdentityStudent123'})).cookie));
  const termId=(await call('/admin/timetable/terms',{academicYear:term.academicYear,name:term.name,startsOn:'2026-09-01',endsOn:'2027-01-31'},admin)).data.id;
  const courses=[course,{...course,explicit_sessions:[lesson('2026-11-15')]},{...course,teacher:'乙老师'}];
  // One student imports before the administrator creates the catalog.
  assert.equal((await call('/timetable/'+termId,{source:'ai',courses:[courses[0]],acceptWarnings:true},cookies[0])).status,200);
  const preview=await call('/admin/timetable/template-preview',{termId,source:'ai',courses},admin);assert.equal(preview.status,200);assert.equal(preview.data.courses.length,3);
  assert.equal((await call('/admin/timetable/template-import',{termId,source:'ai',name:'无班号模板',courses:preview.data.courses,catalogVersion:preview.data.catalogVersion,acceptWarnings:true},admin)).status,201);
  for(const i of [1,2]){const selected=await call('/timetable/'+termId,{source:'ai',courses:[{...courses[i],teaching_class_code:'不会用于匹配'}],acceptWarnings:true},cookies[i]);assert.equal(selected.status,200);assert.ok(selected.data.courses[0].publicCourseId);}
  const options=(await call('/admin/homework/classes?termId='+termId,undefined,admin)).data;assert.equal(options.length,3);assert.ok(options.every(option=>option.timeLabel&&!option.label.includes('班号')&&!option.classCode));
  for(const [i,option] of options.entries()){
    assert.equal((await call('/admin/homework/records',{termId,record:{kind:'assignment',course_name:option.courseName,teacher:option.teacher,title:'对应作业-'+i,content:'课程报告',targetKeys:[option.key],published:true}},admin)).status,201);
  }
  for(const [i,cookie] of cookies.entries()){
    const records=(await call('/homework',undefined,cookie)).data.records;assert.equal(records.length,1);
    const expected=options.findIndex(option=>option.teacher===courses[i].teacher&&option.timeLabel.includes(courses[i].explicit_sessions[0].date));assert.equal(records[0].title,'对应作业-'+expected);
  }
  const duplicate=await call('/admin/timetable/courses',{termId,source:'manual',courses:[{...course,teaching_class_code:'不同旧班号'}],acceptWarnings:true},admin);assert.equal(duplicate.status,409);
  assert.equal((await call('/admin/homework/records',{termId,record:{kind:'assignment',course_name:'工程经济学',teacher:'甲老师',title:'不能再按班号发布',content:'内容',targetKeys:['code:OLD'],published:true}},admin)).status,400);
});
test('历史班号作业只迁移一次为课程引用，保留作业、完成记录及旧模板',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1)');initTimetableSchema(db);initHomeworkSchema(db);
  db.prepare('INSERT INTO terms(id,academic_year,name,config_json) VALUES(?,?,?,?)').run(term.id,term.academicYear,term.name,JSON.stringify(term.config));
  db.prepare('INSERT INTO public_courses(id,term_id,class_code,payload_json) VALUES(?,?,?,?)').run('legacy-course',term.id,'OLD',JSON.stringify(course));
  db.prepare('INSERT INTO homework_records(id,term_id,source_key,kind,title,payload_json,published,created_by) VALUES(?,?,?,?,?,?,1,1)').run('old-work',term.id,'key','assignment','原作业',JSON.stringify({course_name:'工程经济学',teacher:'甲老师'}));
  db.exec("INSERT INTO homework_targets(record_id,target_key,class_code) VALUES('old-work','code:OLD','OLD');INSERT INTO homework_completions(user_id,record_id,completed_revision) VALUES(1,'old-work',1);ALTER TABLE homework_targets DROP COLUMN identity_key");
  initHomeworkSchema(db);initHomeworkSchema(db);
  const target=db.prepare('SELECT * FROM homework_targets').get();assert.equal(target.course_id,'legacy-course');assert.ok(target.identity_key);assert.equal(db.prepare('SELECT title FROM homework_records').get().title,'原作业');assert.equal(db.prepare('SELECT count(*) n FROM homework_completions').get().n,1);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
});
