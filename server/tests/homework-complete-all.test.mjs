import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';
import {initHomeworkSchema} from '../homework-schema.mjs';

test('管理员全员完成涵盖之后选课与新账号，个人状态可覆盖，权限及其他作业隔离',async t=>{
 const {server,db}=await createApp({databasePath:':memory:'});
 await createInitialAdmin(db,'complete-all-admin','测试管理员','CompleteAllAdmin123');
 const password=await hashPassword('CompleteAllStudent123');
 const addStudent=id=>db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run(id,id,password);
 for(const id of ['one','later','unrelated'])addStudent(id);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function call(path,method='GET',body,cookie){
  const response=await fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 const admin=(await call('/auth/login','POST',{studentId:'complete-all-admin',password:'CompleteAllAdmin123'})).cookie;
 const login=async id=>(await call('/auth/login','POST',{studentId:id,password:'CompleteAllStudent123'})).cookie;
 const one=await login('one'),later=await login('later'),unrelated=await login('unrelated');
 const termId=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'第一学期'},admin)).data.id;
 for(const teacher of ['甲老师','乙老师'])assert.equal((await call('/admin/timetable/courses','POST',{termId,source:'manual',acceptWarnings:true,courses:[{course_name:'同名课程',teacher,explicit_sessions:[{date:'2026-11-14',start_time:'08:00',end_time:'10:00',room:'教室'}]}]},admin)).status,201);
 const cards=(await call('/admin/timetable/courses?termId='+termId,'GET',undefined,admin)).data;
 const card=cards.find(c=>c.teacher==='甲老师'),other=cards.find(c=>c.teacher==='乙老师');
 const enroll=async(cookie,courseId)=>{const response=await call('/timetable/'+termId,'POST',{source:'cards',courseIds:[courseId],revision:0,acceptWarnings:true},cookie);assert.equal(response.status,200);return response.data.courses[0];};
 const entry=await enroll(one,card.id);await enroll(unrelated,other.id);
 const record={kind:'assignment',title:'第一次作业',content:'课程报告',autoPublish:true,targetKeys:['course:'+card.id],attachments:[]};
 const work=(await call('/admin/homework/records','POST',{termId,record},admin)).data;
 const second=(await call('/admin/homework/records','POST',{termId,record:{...record,title:'第二次作业'}},admin)).data;
 const endpoint='/admin/homework/records/'+work.id+'/complete-all',body={revision:work.revision,generation:0,confirm:true};
 const mine=async(cookie,id=work.id)=>(await call('/homework','GET',undefined,cookie)).data.records.find(r=>r.id===id);
 const completion=async(cookie,completed,revision=work.revision)=>call('/homework/records/'+work.id+'/completion','POST',{revision,completed},cookie);
 await call('/homework/records/'+work.id+'/preferences','PUT',{revision:work.revision,priority:'high',planned_date:'2026-11-12'},one);
 assert.equal((await call(endpoint,'POST',body,one)).status,403);
 assert.equal((await call(endpoint,'POST',body)).status,401);
 assert.equal((await call(endpoint,'POST',{...body,revision:999},admin)).status,409);
 assert.equal((await call(endpoint,'POST',{...body,confirm:false},admin)).status,400);
 assert.equal((await mine(one)).completed,false);
 assert.equal((await call(endpoint,'POST',body,admin)).status,200);
 assert.equal((await mine(one)).completed,true);assert.ok((await mine(one)).completedAt);
 assert.equal((await mine(one)).planned_date,'2026-11-12');assert.equal((await mine(one)).priority,'high');
 assert.equal((await mine(one,second.id)).completed,false);assert.equal(await mine(unrelated),undefined);
 assert.equal((await completion(unrelated,false)).status,403);
 assert.ok(!(await call('/homework/summary','GET',undefined,one)).data.records.some(r=>r.id===work.id));
 const detail=(await call('/homework/course/'+entry.id,'GET',undefined,one)).data;assert.equal(detail.records.find(r=>r.id===work.id).completed,true);
 await enroll(later,card.id);assert.equal((await mine(later)).completed,true);
 addStudent('new-account');const newcomer=await login('new-account');await enroll(newcomer,card.id);assert.equal((await mine(newcomer)).completed,true);
 assert.equal((await completion(one,false)).data.completed,false);assert.equal((await mine(one)).completed,false);assert.equal((await mine(later)).completed,true);
 assert.equal((await completion(later,false)).data.completed,false);
 assert.equal((await completion(one,true)).data.completed,true);assert.equal((await mine(later)).completed,false);
 // Re-importing updated content preserves personal exceptions and default policy.
 const previewRecord={...work,title:work.title,content:'更新报告内容',targetKeys:work.targets.map(t=>t.key),existingRevision:work.revision};
 assert.equal((await call('/admin/homework/import','POST',{termId,records:[previewRecord],assets:[],confirm:true},admin)).status,201);
 const updated=await mine(one);assert.equal(updated.completed,true);assert.equal((await mine(later)).completed,false);assert.equal(updated.priority,'high');
 // Reinitializing an existing schema must retain both the policy and exceptions.
 initHomeworkSchema(db);assert.equal((await mine(later)).completed,false);assert.equal((await mine(newcomer)).completed,true);
 assert.equal((await call(endpoint,'POST',{...body,revision:updated.revision},admin)).status,409);
 assert.equal((await call(endpoint,'POST',{...body,revision:updated.revision,generation:1},admin)).status,200);
 assert.equal((await mine(later)).completed,true);assert.equal((await completion(later,false,updated.revision)).data.completed,false);
 // Reset is a new default generation. Old individual completions do not win
 // against it, but each student can explicitly complete again afterwards.
 const reset={revision:updated.revision,generation:2,confirm:true,completed:false};
 assert.equal((await call(endpoint,'POST',reset,one)).status,403);
 const undone=await call(endpoint,'POST',reset,admin);assert.equal(undone.status,200);assert.equal(undone.data.allCompletionState,false);assert.equal(undone.data.allCompletedGeneration,3);
 assert.equal((await mine(one)).completed,false);assert.equal((await mine(later)).completed,false);assert.equal((await mine(newcomer)).completed,false);
 assert.equal((await mine(one)).priority,'high');assert.equal((await mine(one)).planned_date,'2026-11-12');
 assert.equal((await completion(one,true,updated.revision)).data.completed,true);assert.equal((await mine(later)).completed,false);
 addStudent('after-reset');const afterReset=await login('after-reset');await enroll(afterReset,card.id);assert.equal((await mine(afterReset)).completed,false);
 const republished=await call('/admin/homework/import','POST',{termId,records:[{...previewRecord,content:'重置后更新内容',existingRevision:updated.revision}],assets:[],confirm:true},admin);assert.equal(republished.status,201);
 const finalVersion=(await mine(one)).revision;assert.equal((await mine(one)).completed,true);assert.equal((await mine(later)).completed,false);
 assert.equal((await call(endpoint,'POST',{...reset,revision:finalVersion},admin)).status,409);
 assert.equal((await call(endpoint,'POST',{revision:finalVersion,generation:3,confirm:true,completed:true},admin)).status,200);
 assert.equal((await mine(later)).completed,true);
 const personal=(await call('/homework/personal','POST',{termId,record:{kind:'assignment',title:'个人作业',course_entry_id:entry.id,attachments:[]}},one)).data;
 assert.equal((await call('/admin/homework/records/'+personal.id+'/complete-all','POST',{confirm:true,revision:personal.revision},admin)).status,400);
 const reference=(await call('/admin/homework/records','POST',{termId,record:{...record,kind:'reference',title:'考核说明',assessment_rules:'期末报告'}},admin)).data;
 assert.equal((await call('/admin/homework/records/'+reference.id+'/complete-all','POST',{confirm:true,revision:reference.revision},admin)).status,400);
 assert.equal((await call('/admin/homework/records/'+work.id,'DELETE',{confirm:true,revision:finalVersion},admin)).status,200);
 assert.equal(db.prepare('SELECT count(*) n FROM homework_completion_defaults').get().n,0);
 assert.equal(db.prepare('SELECT count(*) n FROM homework_completion_exceptions').get().n,0);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
