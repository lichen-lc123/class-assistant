import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';
import {createInitialAdmin} from '../database.mjs';

test('双端提示词使用服务端最新目标学期配置，作息前置，空配置不补造',async t=>{
 const {server,db}=await createApp({databasePath:':memory:'});
 await createInitialAdmin(db,'prompt-admin','测试班委','PromptTest123');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({studentId:'prompt-admin',password:'PromptTest123'})});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const call=async(path,method='GET',body)=>{const r=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
 const input={academicYear:'2028-2029',name:'测试学期',startsOn:'2028-09-04',endsOn:'2029-01-31',config:{calendars:[{name:'测试教学周',start_date:'2028-09-04'}],periods:[{number:2,start:'08:10',end:'09:00'},{number:5,start:'11:10',end:'12:10'}]}};
 const created=await call('/admin/timetable/terms','POST',input);assert.equal(created.status,201);
 const path='/timetable/prompt?termId='+created.data.id;
 const before=db.prepare('SELECT count(*) n FROM timetables').get().n;
 const desktop=await call(path);assert.equal(desktop.status,200);
 const mobile=await fetch(base+'/api'+path,{headers:{Cookie:cookie,'User-Agent':'Mozilla/5.0 (Linux; Android 14) Mobile MicroMessenger'}});
 assert.equal((await mobile.json()).text,desktop.data.text);
 const prompt=desktop.data.text;
 assert.ok(prompt.indexOf('完整配置：')<prompt.indexOf('必须遵守：'));
 assert.ok(prompt.includes('2—5节 = 08:10—12:10'));assert.ok(!prompt.includes('6—9节 ='));
 assert.ok(prompt.includes('网站目标学年：2028-2029'));assert.ok(prompt.includes('"start_date":"2028-09-04"'));
 // A copied calendar's end must not become an import cutoff. Check the real
 // preview API, including a dated lesson whose time is genuinely unknown.
 const inspection=await call('/timetable/preview','POST',{termId:created.data.id,source:'ai',text:JSON.stringify({schema_version:'timetable.v1',academic_year:input.academicYear,semester:input.name,courses:[{course_name:'明确日期边界测试',teacher:'测试老师',explicit_sessions:[{date:'2028-09-01',start_time:'08:10',end_time:'12:10'},{date:'2029-02-07',start_time:'08:10',end_time:'12:10'}]},{course_name:'明确日期时间待定测试',special_dates:[{date:'2029-02-14',kind:'lecture',raw:'原文明示的日期，具体时分待通知'}]}]})});
 assert.equal(inspection.status,200);
 assert.deepEqual(inspection.data.courses[0].sessions.map(s=>s.date),['2028-09-01','2029-02-07']);
 assert.equal(inspection.data.courses[1].special_dates[0].date,'2029-02-14');assert.equal(inspection.data.courses[1].sessions.length,0);
 assert.equal(inspection.data.unparsedItems.length,0);
 const updated=await call('/admin/timetable/terms/'+created.data.id,'PUT',{...input,revision:created.data.revision,config:{...input.config,periods:[{number:2,start:'09:10',end:'10:00'},{number:5,start:'12:10',end:'13:10'}]}});assert.equal(updated.status,200);
 const latest=(await call(path)).data.text;assert.ok(latest.includes('2—5节 = 09:10—13:10'));assert.ok(!latest.includes('2—5节 = 08:10—12:10'));
 const empty=await call('/admin/timetable/terms','POST',{academicYear:'2029-2030',name:'尚未配置'});assert.equal(empty.status,201);
 const emptyPrompt=(await call('/timetable/prompt?termId='+empty.data.id)).data.text;
 assert.ok(emptyPrompt.includes('网站尚未配置节次作息'));assert.ok(emptyPrompt.includes('"periods":[]'));assert.ok(!emptyPrompt.includes('2—5节 ='));
 assert.equal((await call('/timetable/prompt?termId=missing-term')).status,404);
 assert.equal((await fetch(base+'/api'+path)).status,401);
 assert.equal(db.prepare('SELECT count(*) n FROM timetables').get().n,before);
 assert.equal(db.prepare('SELECT count(*) n FROM timetable_entries').get().n,0);
});
