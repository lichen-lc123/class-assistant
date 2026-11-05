import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app.mjs';
import {createInitialAdmin,hashPassword} from '../database.mjs';
import {reminderDefaults,validateReminderSettings} from '../reminder-settings.mjs';

test('提醒偏好校验限制提前时间及开关，开启截止提醒时至少选择一项时间依据',()=>{
  const valid={...reminderDefaults,revision:0};assert.deepEqual(validateReminderSettings(valid),reminderDefaults);
  assert.throws(()=>validateReminderSettings({...valid,courseEnabled:'true'}),/开关/);
  assert.throws(()=>validateReminderSettings({...valid,courseLeadMinutes:5}),/上课提醒/);
  assert.throws(()=>validateReminderSettings({...valid,homeworkLeadMinutes:0}),/作业提醒/);
  assert.throws(()=>validateReminderSettings({...valid,remindOfficialDeadline:false,remindPersonalPlan:false}),/至少选择/);
  assert.doesNotThrow(()=>validateReminderSettings({...valid,homeworkDueEnabled:false,remindOfficialDeadline:false,remindPersonalPlan:false}));
  assert.throws(()=>validateReminderSettings({...valid,userId:3}),/不支持/);
  assert.throws(()=>validateReminderSettings({...valid,revision:-1}),/版本/);
});
test('个人提醒设置按登录账号保存，学生与管理员互相隔离，支持版本保护及级联清理',async t=>{
  const {server,db}=await createApp({databasePath:':memory:'});await createInitialAdmin(db,'reminder-admin','管理员','ReminderAdmin123');
  const pass=await hashPassword('ReminderStudent123');for(const [id,mustChange]of [['reminder-one',0],['reminder-two',0],['reminder-new',1]])db.prepare('INSERT INTO users(student_id,name,password_hash,must_change_password) VALUES(?,?,?,?)').run(id,id,pass,mustChange);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
  async function call(path,method='GET',body,cookie,origin=base){const response=await fetch(base+'/api'+path,{method,headers:{...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login','POST',{studentId:'reminder-admin',password:'ReminderAdmin123'})).cookie;
  const one=(await call('/auth/login','POST',{studentId:'reminder-one',password:'ReminderStudent123'})).cookie,two=(await call('/auth/login','POST',{studentId:'reminder-two',password:'ReminderStudent123'})).cookie,first=(await call('/auth/login','POST',{studentId:'reminder-new',password:'ReminderStudent123'})).cookie;
  assert.equal((await call('/reminder-settings')).status,401);assert.equal((await call('/reminder-settings','GET',undefined,first)).status,403);
  const initial=await call('/reminder-settings','GET',undefined,one);assert.equal(initial.status,200);assert.equal(initial.data.revision,0);assert.equal(initial.data.updatedAt,null);assert.equal(initial.data.deliveryStatus,'not_connected');assert.equal(db.prepare('SELECT COUNT(*) n FROM reminder_settings').get().n,0);
  const payload={...reminderDefaults,revision:0,courseEnabled:false,courseLeadMinutes:60,homeworkLeadMinutes:360,remindPersonalPlan:false};
  assert.equal((await call('/reminder-settings','PUT',payload,one,'https://other.example')).status,403);
  assert.equal((await call('/reminder-settings','PUT',{...payload,userId:2},one)).status,400);
  const saved=await call('/reminder-settings?userId=reminder-two','PUT',payload,one);assert.equal(saved.status,200);assert.equal(saved.data.revision,1);assert.equal(saved.data.courseEnabled,false);assert.ok(saved.data.updatedAt);assert.equal(saved.data.deliveryStatus,'not_connected');
  const read=await call('/reminder-settings','GET',undefined,one);assert.equal(read.data.courseLeadMinutes,60);assert.equal(read.data.remindPersonalPlan,false);
  for(const cookie of [two,admin]){const isolated=(await call('/reminder-settings','GET',undefined,cookie)).data;assert.equal(isolated.revision,0);assert.equal(isolated.courseEnabled,true);assert.equal(isolated.homeworkLeadMinutes,1440);}
  assert.equal((await call('/reminder-settings','PUT',{...payload,courseLeadMinutes:15},one)).status,409);
  assert.equal((await call('/reminder-settings','GET',undefined,one)).data.courseLeadMinutes,60);
  assert.equal((await call('/reminder-settings','PUT',{...payload,revision:1,courseLeadMinutes:15},one)).data.revision,2);
  assert.equal((await call('/reminder-settings','POST',payload,one)).status,405);
  const ownId=db.prepare("SELECT id FROM users WHERE student_id='reminder-one'").get().id;db.prepare('DELETE FROM users WHERE id=?').run(ownId);assert.equal(db.prepare('SELECT COUNT(*) n FROM reminder_settings').get().n,0);assert.equal((await call('/reminder-settings','GET',undefined,one)).status,401);
});
