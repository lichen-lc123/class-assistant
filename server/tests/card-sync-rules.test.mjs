import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';

test('模板生成卡片双向同步，手动卡片独立同步，追加卡片检查模板占用',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});
  await createInitialAdmin(db,'contract-admin','学委','ContractAdminFixture123');
  const password=await hashPassword('ContractStudentFixture123');
  for(const name of ['template','auto','manual','manual-template'])db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,0)').run('contract-'+name,name,password);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  async function call(path,method='GET',body,cookie){const response=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{Origin:base,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login','POST',{studentId:'contract-admin',password:'ContractAdminFixture123'})).cookie;
  const cookies={};for(const name of ['template','auto','manual','manual-template'])cookies[name]=(await call('/auth/login','POST',{studentId:'contract-'+name,password:'ContractStudentFixture123'})).cookie;
  const termId=(await call('/admin/timetable/terms','POST',{academicYear:'2026-2027',name:'第一学期',startsOn:'2026-09-01',endsOn:'2027-01-31'},admin)).data.id;
  const raw=(name,date,teacher='老师',start='08:00',end='10:00')=>({course_name:name,teacher,explicit_sessions:[{date,start_time:start,end_time:end,room:'公共教室'}]});
  const ai=raw('自动课程','2026-11-14');
  const preview=(await call('/admin/timetable/template-preview','POST',{termId,source:'ai',courses:[ai]},admin)).data;
  const generated=await call('/admin/timetable/template-import','POST',{termId,source:'ai',name:'自动模板',courses:preview.courses,catalogVersion:preview.catalogVersion,acceptWarnings:true},admin);assert.equal(generated.status,201);const templateId=generated.data.id;
  const catalog=async()=>(await call('/admin/timetable/courses?termId='+termId,'GET',undefined,admin)).data;
  const templates=async()=>(await call('/admin/timetable/templates?termId='+termId,'GET',undefined,admin)).data;
  const get=async cookie=>(await call('/timetable/'+termId,'GET',undefined,cookie)).data;
  const select=async(cookie,input)=>call('/timetable/'+termId,'POST',{...input,revision:(await get(cookie)).timetable?.revision||0,acceptWarnings:true},cookie);
  const auto=(await catalog())[0];assert.equal(auto.origin,'template');
  assert.equal((await select(cookies.template,{source:'template',templateId})).status,200);
  assert.equal((await select(cookies.auto,{source:'cards',courseIds:[auto.id]})).status,200);
  assert.equal((await call('/admin/timetable/courses','POST',{termId,source:'manual',courses:[raw('手动课程','2026-11-16')],acceptWarnings:true},admin)).status,201);
  const manual=(await catalog()).find(c=>c.origin==='manual');assert.ok(manual);
  const manualTemplateId=(await call('/admin/timetable/templates','POST',{termId,name:'含手动课程模板',courseIds:[manual.id]},admin)).data.id;
  assert.equal((await select(cookies.manual,{source:'cards',courseIds:[manual.id]})).status,200);
  assert.equal((await select(cookies['manual-template'],{source:'template',templateId:manualTemplateId})).status,200);
  await t.test('修改自动生成卡片同步未编辑用户，已编辑模板课程保持个人内容',async()=>{
    const own=await get(cookies.template),entry=own.courses[0];
    assert.equal((await call(`/timetable/${termId}/entries/${entry.id}`,'PATCH',{revision:own.timetable.revision,publicRevision:entry.publicRevision,sessions:entry.sessions.map(s=>({...s,room:'个人教室'}))},cookies.template)).status,200);
    const changed=raw('自动课程新名称','2026-11-18','新老师');
    assert.equal((await call('/admin/timetable/courses/'+auto.id,'PUT',{course:changed,revision:auto.revision,acceptWarnings:true},admin)).status,200);
    const template=(await templates()).find(t=>t.id===templateId);assert.equal(template.courses[0].course_name,changed.course_name);
    {const c=(await get(cookies.auto)).courses[0];assert.equal(c.course_name,changed.course_name);assert.equal(c.teacher,'新老师');assert.equal(c.sessions[0].date,'2026-11-18');} assert.equal((await get(cookies.template)).courses[0].course_name,'自动课程');assert.equal((await get(cookies.template)).courses[0].sessions[0].date,'2026-11-14');
    assert.equal((await get(cookies.template)).courses[0].sessions[0].room,'个人教室');
  });
  await t.test('模板中编辑课程修改卡片及未编辑用户，个人保留者不变，旧版与越权请求被拒绝',async()=>{
    const template=(await templates()).find(t=>t.id===templateId),card=(await catalog()).find(c=>c.id===auto.id),changed=raw('模板内修订课程','2026-11-20','模板老师','13:00','15:00');
    const body={name:template.name,revision:template.revision,courseIds:template.courseIds,courseChanges:[{id:auto.id,revision:card.revision,course:changed}],acceptWarnings:true};
    assert.equal((await call('/admin/timetable/templates/'+templateId,'PUT',body,cookies.template)).status,403);
    assert.equal((await call('/admin/timetable/templates/'+templateId,'PUT',{...body,courseChanges:[{...body.courseChanges[0],revision:0}]},admin)).status,409);
    assert.equal((await call('/admin/timetable/templates/'+templateId,'PUT',body,admin)).status,200);
    assert.equal((await catalog()).find(c=>c.id===auto.id).teacher,'模板老师');
    assert.equal((await get(cookies.auto)).courses[0].sessions[0].start_time,'13:00');assert.equal((await get(cookies.template)).courses[0].sessions[0].start_time,'08:00');
    assert.equal((await get(cookies.template)).courses[0].sessions[0].room,'个人教室');
    const current=(await templates()).find(t=>t.id===templateId),before=(await catalog()).find(c=>c.id===auto.id);
    const bad=await call('/admin/timetable/templates/'+templateId,'PUT',{...body,name:'不应保存',revision:current.revision,courseChanges:[{id:auto.id,revision:before.revision,course:raw('不应写入','2026-11-21')},{id:manual.id,revision:1,course:raw('不应越出模板','2026-11-22')}]},admin);
    assert.equal(bad.status,400);assert.equal((await templates()).find(t=>t.id===templateId).name,current.name);assert.equal((await catalog()).find(c=>c.id===auto.id).course_name,before.course_name);
  });
  await t.test('手动卡片修改只联动直接选用用户，现有模板及模板用户保持原安排',async()=>{
    const changed=raw('手动卡片新名称','2026-11-17','手动新老师');
    assert.equal((await call('/admin/timetable/courses/'+manual.id,'PUT',{course:changed,revision:manual.revision,acceptWarnings:true,origin:'template'},admin)).status,200);
    const current=(await catalog()).find(c=>c.id===manual.id);assert.equal(current.origin,'manual');assert.equal(current.course_name,changed.course_name);
    assert.equal((await get(cookies.manual)).courses[0].teacher,'手动新老师');
    assert.equal((await get(cookies['manual-template'])).courses[0].teacher,'老师');assert.equal((await get(cookies['manual-template'])).courses[0].sessions[0].date,'2026-11-16');
    assert.equal((await templates()).find(t=>t.id===manualTemplateId).courses[0].teacher,'老师');
    assert.equal((await select(admin,{source:'template',templateId:manualTemplateId})).status,200);
    assert.equal((await get(admin)).courses[0].sessions[0].date,'2026-11-16');
  });
  await t.test('编辑模板中的手动课程仅更新该模板副本，不更改独立卡片',async()=>{
    const template=(await templates()).find(t=>t.id===manualTemplateId),card=(await catalog()).find(c=>c.id===manual.id);
    const change=raw('模板独立的手动课程','2026-11-19','模板独立老师');
    assert.equal((await call('/admin/timetable/templates/'+manualTemplateId,'PUT',{name:template.name,revision:template.revision,courseIds:[manual.id],courseChanges:[{id:manual.id,revision:card.revision,course:change}],acceptWarnings:true},admin)).status,200);
    assert.equal((await get(cookies['manual-template'])).courses[0].teacher,'模板独立老师');assert.equal((await get(admin)).courses[0].teacher,'模板独立老师');
    assert.equal((await get(cookies.manual)).courses[0].teacher,'手动新老师');assert.equal((await catalog()).find(c=>c.id===manual.id).teacher,'手动新老师');
  });
  await t.test('同一手动卡片的模板副本与新增卡片时间不同可并存，各自后续更新',async()=>{
    assert.equal((await select(cookies['manual-template'],{source:'cards',courseIds:[manual.id]})).status,200);
    assert.deepEqual((await get(cookies['manual-template'])).courses.map(c=>c.sessions[0].date).sort(),['2026-11-17','2026-11-19']);
    const card=(await catalog()).find(c=>c.id===manual.id);
    assert.equal((await call('/admin/timetable/courses/'+manual.id,'PUT',{course:raw('手动卡片再更新','2026-11-18','手动新老师'),revision:card.revision,acceptWarnings:true},admin)).status,200);
    const template=(await templates()).find(t=>t.id===manualTemplateId),latestCard=(await catalog()).find(c=>c.id===manual.id);
    assert.equal((await call('/admin/timetable/templates/'+manualTemplateId,'PUT',{name:template.name,revision:template.revision,courseIds:[manual.id],courseChanges:[{id:manual.id,revision:latestCard.revision,course:raw('模板副本再更新','2026-11-21','副本老师')}],acceptWarnings:true},admin)).status,200);
    assert.deepEqual((await get(cookies['manual-template'])).courses.map(c=>c.sessions[0].date).sort(),['2026-11-18','2026-11-21']);
  });
  await t.test('导入模板后追加卡片，预览提示时间冲突且保存无法绕过',async()=>{
    const conflicting=raw('冲突新卡片','2026-11-14','另一老师','09:00','11:00');
    assert.equal((await call('/admin/timetable/courses','POST',{termId,source:'manual',courses:[conflicting],acceptWarnings:true},admin)).status,201);
    const card=(await catalog()).find(c=>c.course_name===conflicting.course_name),own=await get(cookies.template),before=db.prepare('SELECT * FROM timetable_entries ORDER BY id').all();
    const p=await call('/timetable/selection-preview','POST',{termId,source:'cards',courseIds:[card.id]},cookies.template);assert.equal(p.status,200);assert.equal(p.data.importBlocked,true);assert.match(p.data.importError,/课程时间重复/);assert(p.data.importError.includes('2026-11-14'));assert(p.data.importError.includes('自动课程'));
    assert.equal((await select(cookies.template,{source:'cards',courseIds:[card.id]})).status,409);assert.deepEqual(db.prepare('SELECT * FROM timetable_entries ORDER BY id').all(),before);assert.equal((await get(cookies.template)).timetable.revision,own.timetable.revision);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
});
