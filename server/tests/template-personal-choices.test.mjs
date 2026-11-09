import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';
import {initTimetableSchema} from '../timetable-schema.mjs';
import {contentFingerprint,verifyContent} from '../../scripts/content-fingerprint.mjs';

const course=(name,date='2026-11-14',teacher='原老师')=>({course_name:name,teacher,explicit_sessions:[{date,start_time:'08:00',end_time:'10:00',room:'公共教室'}]});
async function setup(t){
 const {server,db}=await createApp({databasePath:':memory:'});await createInitialAdmin(db,'choices-admin','测试班委','ChoicesFixture123');
 const password=await hashPassword('ChoicesFixture123');for(const id of ['edited','untouched','cards'])db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run(id,id,password);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 async function call(path,method='GET',body,cookie){const response=await fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 const login=async id=>(await call('/auth/login','POST',{studentId:id,password:'ChoicesFixture123'})).cookie;
 const admin=await login('choices-admin'),cookies={};for(const id of ['edited','untouched','cards'])cookies[id]=await login(id);
 const termId=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'第一学期',startsOn:'2026-09-01',endsOn:'2027-01-31'},admin)).data.id;
 await call('/admin/timetable/courses','POST',{termId,courses:[course('课程甲'),course('课程乙','2026-11-15'),course('课程丙','2026-11-16')],acceptWarnings:true},admin);
 const catalog=async()=>(await call('/admin/timetable/courses?termId='+termId,'GET',undefined,admin)).data;
 const cards=await catalog(),a=cards.find(c=>c.course_name==='课程甲').id,b=cards.find(c=>c.course_name==='课程乙').id,c=cards.find(c=>c.course_name==='课程丙').id;
 const templateId=(await call('/admin/timetable/templates','POST',{termId,name:'模板一',courseIds:[a,b]},admin)).data.id;
 const get=async cookie=>(await call('/timetable/'+termId,'GET',undefined,cookie)).data;
 const select=async(cookie,body)=>call('/timetable/'+termId,'POST',{...body,revision:(await get(cookie)).timetable?.revision||0,acceptWarnings:true},cookie);
 const templates=async()=>(await call('/admin/timetable/templates?termId='+termId,'GET',undefined,admin)).data;
 const updateTemplate=async(ids,id=templateId)=>{const old=(await templates()).find(t=>t.id===id);const result=await call('/admin/timetable/templates/'+id,'PUT',{name:old.name+'新版',courseIds:ids,revision:old.revision},admin);assert.equal(result.status,200,JSON.stringify(result.data));};
 const updateCard=async(id,raw)=>{const old=(await catalog()).find(c=>c.id===id);const result=await call('/admin/timetable/courses/'+id,'PUT',{course:raw,revision:old.revision,acceptWarnings:true},admin);assert.equal(result.status,200,JSON.stringify(result.data));};
 return{db,call,admin,cookies,termId,a,b,c,templateId,get,select,templates,updateTemplate,updateCard,catalog};
}

test('编辑模板课程后整门保留个人内容，其他课程继续同步；移除不补回，恢复默认可重新跟随',async t=>{
 const f=await setup(t);for(const key of ['edited','untouched'])assert.equal((await f.select(f.cookies[key],{source:'template',templateId:f.templateId})).status,200);
 await f.select(f.cookies.cards,{source:'cards',courseIds:[f.a,f.b]});
 let own=await f.get(f.cookies.edited),entry=own.courses.find(c=>c.publicCourseId===f.a);
 const edit=await f.call(`/timetable/${f.termId}/entries/${entry.id}`,'PATCH',{revision:own.timetable.revision,publicRevision:entry.publicRevision,sessions:entry.sessions.map(s=>({...s,room:'我的教室'}))},f.cookies.edited);assert.equal(edit.status,200);
 await f.updateCard(f.a,course('课程甲新版','2026-11-21','新老师'));
 own=await f.get(f.cookies.edited);const frozen=own.courses.find(c=>c.id===entry.id);assert.equal(frozen.course_name,'课程甲');assert.equal(frozen.teacher,'原老师');assert.equal(frozen.sessions[0].date,'2026-11-14');assert.equal(frozen.sessions[0].room,'我的教室');assert.equal(frozen.templateSyncPaused,true);
 for(const cookie of [f.cookies.untouched,f.cookies.cards])assert.equal((await f.get(cookie)).courses.find(c=>c.publicCourseId===f.a).course_name,'课程甲新版');
 await f.updateTemplate([f.b,f.c]);own=await f.get(f.cookies.edited);assert.deepEqual(own.courses.map(c=>c.publicCourseId).sort(),[f.a,f.b,f.c].sort());
 assert.deepEqual((await f.get(f.cookies.untouched)).courses.map(c=>c.publicCourseId).sort(),[f.b,f.c].sort());
 const removed=own.courses.find(c=>c.publicCourseId===f.b);assert.equal((await f.call(`/timetable/${f.termId}/entries/${removed.id}`,'DELETE',{revision:own.timetable.revision},f.cookies.edited)).status,200);
 await f.updateTemplate([f.a,f.b,f.c]);await f.updateCard(f.b,course('课程乙新版','2026-11-22'));await f.updateCard(f.c,course('课程丙新版','2026-11-23'));
 own=await f.get(f.cookies.edited);assert.deepEqual(own.courses.map(c=>c.publicCourseId).sort(),[f.a,f.c].sort());assert.equal(own.courses.find(c=>c.publicCourseId===f.c).course_name,'课程丙新版');assert.equal(own.courses.find(c=>c.publicCourseId===f.a).course_name,'课程甲');
 const reset=await f.call(`/timetable/${f.termId}/entries/${entry.id}/reset`,'POST',{revision:own.timetable.revision},f.cookies.edited);assert.equal(reset.status,200);assert.equal(reset.data.courses.find(c=>c.id===entry.id).templateSyncPaused,false);assert.equal(reset.data.courses.find(c=>c.id===entry.id).course_name,'课程甲新版');
 await f.updateCard(f.a,course('恢复后继续更新','2026-11-24'));assert.equal((await f.get(f.cookies.edited)).courses.find(c=>c.id===entry.id).course_name,'恢复后继续更新');
 own=await f.get(f.cookies.edited);assert.equal((await f.select(f.cookies.edited,{source:'cards',courseIds:[f.b]})).status,200);assert.equal((await f.get(f.cookies.edited)).courses.length,3);
 assert.equal((await f.call(`/timetable/${f.termId}/entries/${entry.id}`,'DELETE',{revision:1},f.cookies.edited)).status,409);
 own=await f.get(f.cookies.edited);assert.equal((await f.call('/timetable/'+f.termId,'DELETE',{revision:own.timetable.revision,confirm:true},f.cookies.edited)).status,200);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('老版本已编辑与已移除的模板课程在后续更新时兼容保护，启动不重写业务数据',async t=>{
 const f=await setup(t);await f.select(f.cookies.edited,{source:'template',templateId:f.templateId});
 const own=await f.get(f.cookies.edited),a=own.courses.find(c=>c.publicCourseId===f.a),b=own.courses.find(c=>c.publicCourseId===f.b);
 // Reproduce the old release: room overrides existed, but no new choice row or frozen snapshot.
 f.db.prepare('UPDATE timetable_entries SET override_json=?,base_snapshot_json=NULL WHERE id=?').run(JSON.stringify({time_override:null,room_overrides:{0:'旧个人教室'},base_session_count:1}),a.id);
 f.db.prepare('DELETE FROM timetable_entries WHERE id=?').run(b.id);
 assert.equal(f.db.prepare('SELECT count(*) n FROM timetable_template_course_choices').get().n,0);
 await f.updateCard(f.a,course('不能覆盖老编辑','2026-12-01','另一老师'));await f.updateTemplate([f.a,f.b,f.c]);
 const after=await f.get(f.cookies.edited);assert.deepEqual(after.courses.map(c=>c.publicCourseId).sort(),[f.a,f.c].sort());assert.equal(after.courses.find(c=>c.id===a.id).course_name,'课程甲');assert.equal(after.courses.find(c=>c.id===a.id).sessions[0].room,'旧个人教室');
});

test('同一课程来自多个模板时，主动移除对已有来源都生效，其他成员及其他用户不受影响',async t=>{
 const f=await setup(t),second=(await f.call('/admin/timetable/templates','POST',{termId:f.termId,name:'模板二',courseIds:[f.c]},f.admin)).data.id;
 await f.select(f.cookies.edited,{source:'template',templateId:f.templateId});await f.select(f.cookies.edited,{source:'template',templateId:second});await f.select(f.cookies.untouched,{source:'template',templateId:f.templateId});
 await f.updateTemplate([f.a,f.c],second);let own=await f.get(f.cookies.edited),entry=own.courses.find(c=>c.publicCourseId===f.a);assert.equal(own.courses.length,3);
 assert.equal((await f.call(`/timetable/${f.termId}/entries/${entry.id}`,'DELETE',{revision:own.timetable.revision},f.cookies.edited)).status,200);
 await f.updateTemplate([f.a,f.b]);await f.updateTemplate([f.a,f.c],second);
 own=await f.get(f.cookies.edited);assert.deepEqual(own.courses.map(c=>c.publicCourseId).sort(),[f.b,f.c].sort());assert.ok((await f.get(f.cookies.untouched)).courses.some(c=>c.publicCourseId===f.a));
});

test('新表兼容初始化不重写旧业务行；长课表普通用户和管理员预览均完整解析且不保存',async t=>{
 const f=await setup(t);f.db.exec('DROP TABLE timetable_template_course_choices');const before=contentFingerprint(f.db);initTimetableSchema(f.db);verifyContent(before,contentFingerprint(f.db));
 const courses=Array.from({length:20},(_,i)=>({course_name:'长文本课程'+i,teacher:'测试老师'+i,remarks_raw:'这是保留完整的原始资料。'.repeat(200),explicit_sessions:Array.from({length:20},(_,j)=>({date:'2027-01-'+String(j+1).padStart(2,'0'),start_time:'08:00',end_time:'10:00',room:'测试教室',lesson_number:j+1}))}));
 const text='【课表开始】\n'+JSON.stringify({schema_version:'timetable.v1',academic_year:'2026-2027',semester:'第一学期',courses},null,2)+'\n【课表结束】';assert.ok(text.length>100000);
 const snapshot=contentFingerprint(f.db);
 for(const [path,cookie] of [['/timetable/preview',f.cookies.edited],['/admin/timetable/template-preview',f.admin]]){const result=await f.call(path,'POST',{termId:f.termId,source:'ai',text},cookie);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.courses.length,20);assert.ok(result.data.courses.every(c=>c.sessions.length===20));assert.equal(result.data.courses.at(-1).course_name,'长文本课程19');assert.equal(result.data.courses.at(-1).sessions.at(-1).date,'2027-01-20');}
 verifyContent(snapshot,contentFingerprint(f.db));
});
