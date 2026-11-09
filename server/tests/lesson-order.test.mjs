import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';

test('模板、卡片及个人课表按时间编号，个人插入、改期、删除不改变公共安排',async t=>{
 const {server,db}=await createApp({databasePath:':memory:'});await createInitialAdmin(db,'order-admin','测试班委','LessonOrder123');
 db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run('order-student','测试同学',await hashPassword('LessonOrder123'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 async function call(path,method='GET',body,cookie){const r=await fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const login=async id=>(await call('/auth/login','POST',{studentId:id,password:'LessonOrder123'})).cookie;
 const admin=await login('order-admin'),student=await login('order-student');
 const termId=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'课次学期',startsOn:'2026-09-01',endsOn:'2027-01-15'},admin)).data.id;
 const dates=['2026-10-03','2026-10-17','2026-10-31','2026-11-14','2026-11-28','2026-12-12','2027-01-09','2027-01-16'];
 const lessons=dates.map((date,i)=>({date,start_time:'08:50',end_time:'12:25',room:'教室'+i,lesson_number:i+1}));
 const course={course_name:'课次回归课程',teacher:'测试老师',explicit_sessions:[...lessons].reverse()};
 const preview=(await call('/admin/timetable/template-preview','POST',{termId,source:'ai',courses:[course]},admin)).data;
 const imported=await call('/admin/timetable/template-import','POST',{termId,source:'ai',name:'课次模板',courses:preview.courses,catalogVersion:preview.catalogVersion,acceptWarnings:true},admin);assert.equal(imported.status,201);
 const catalog=async()=>(await call('/admin/timetable/courses?termId='+termId,'GET',undefined,admin)).data;
 const templates=async()=>(await call('/admin/timetable/templates?termId='+termId,'GET',undefined,admin)).data;
 let card=(await catalog())[0],template=(await templates())[0];
 assert.deepEqual(card.sessions.map(s=>s.date),dates);assert.deepEqual(template.courses[0].sessions.map(s=>s.lesson_number),[1,2,3,4,5,6,7,8]);
 const added={date:'2026-12-26',start_time:'08:50',end_time:'12:25',room:'新增教室',lesson_number:99};
 const updated=await call('/admin/timetable/courses/'+card.id,'PUT',{revision:card.revision,course:{...course,explicit_sessions:[...course.explicit_sessions,added]},acceptWarnings:true},admin);assert.equal(updated.status,200);
 card=(await catalog())[0];template=(await templates())[0];
 for(const c of [card,template.courses[0]]){assert.equal(c.sessions[6].date,'2026-12-26');assert.equal(c.sessions[7].date,'2027-01-09');assert.deepEqual(c.sessions.map(s=>s.lesson_number),[1,2,3,4,5,6,7,8,9]);}
 const selected=await call('/timetable/'+termId,'POST',{source:'template',templateId:template.id,revision:0,acceptWarnings:true},student);assert.equal(selected.status,200);
 let own=selected.data,entry=own.courses[0];
 const save=async sessions=>{const r=await call(`/timetable/${termId}/entries/${entry.id}`,'PATCH',{revision:own.timetable.revision,publicRevision:entry.publicRevision,sessions},student);assert.equal(r.status,200,JSON.stringify(r.data));own=r.data;entry=own.courses[0];return entry;};
 const personal=await save([...entry.sessions,{...added,date:'2026-12-19',room:'个人教室',lesson_number:88}].reverse());
 assert.equal(personal.sessions[6].date,'2026-12-19');assert.equal(personal.sessions[6].lesson_number,7);assert.equal(personal.sessions[8].date,'2027-01-09');assert.equal(personal.sessions[8].lesson_number,9);
 assert.equal(personal.sessions[6].room,'个人教室');assert.equal(personal.sessions.at(-1).date,'2027-01-16');
 await save(entry.sessions.map(s=>s.date==='2026-12-19'?{...s,date:'2027-01-09',start_time:'13:25',end_time:'17:00'}:s));
 assert.equal(entry.sessions[7].start_time,'08:50');assert.equal(entry.sessions[8].start_time,'13:25');assert.equal(entry.sessions[8].lesson_number,9);
 await save(entry.sessions.filter(s=>s.start_time!=='13:25'));
 assert.deepEqual(entry.sessions.map(s=>s.lesson_number),[1,2,3,4,5,6,7,8,9]);
 assert.equal((await catalog())[0].sessions.length,9);assert.equal((await templates())[0].courses[0].sessions.length,9);
});
