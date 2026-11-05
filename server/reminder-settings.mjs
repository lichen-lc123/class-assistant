import {problem} from './schedule.mjs';

export const reminderDefaults=Object.freeze({
  courseEnabled:true,courseLeadMinutes:30,courseChangesEnabled:true,
  homeworkUpdatesEnabled:true,homeworkDueEnabled:true,homeworkLeadMinutes:1440,
  remindOfficialDeadline:true,remindPersonalPlan:true,
});
const booleanFields=Object.keys(reminderDefaults).filter(key=>typeof reminderDefaults[key]==='boolean');
export function initReminderSettingsSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS reminder_settings(
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`);
}
export function validateReminderSettings(body){
  if(!body||typeof body!=='object'||Array.isArray(body))problem('提醒设置格式不正确。');
  if(Object.keys(body).some(key=>!Object.hasOwn(reminderDefaults,key)&&key!=='revision'))problem('提交了不支持的提醒字段。');
  if(!Number.isInteger(body.revision)||body.revision<0)problem('提醒设置版本无效，请重新读取。');
  for(const key of booleanFields)if(typeof body[key]!=='boolean')problem('提醒开关必须为开启或关闭。');
  if(![15,30,60].includes(body.courseLeadMinutes))problem('上课提醒可选择提前15分钟、30分钟或1小时。');
  if(![60,360,1440,2880].includes(body.homeworkLeadMinutes))problem('作业提醒可选择提前1小时、6小时、1天或2天。');
  if(body.homeworkDueEnabled&&!body.remindOfficialDeadline&&!body.remindPersonalPlan)problem('开启作业截止提醒时，请至少选择一种时间依据。');
  return Object.fromEntries(Object.keys(reminderDefaults).map(key=>[key,body[key]]));
}
export function reminderSettingsService(db){
  function get(userId){const row=db.prepare('SELECT * FROM reminder_settings WHERE user_id=?').get(userId);return{...reminderDefaults,...(row?JSON.parse(row.settings_json):{}),revision:row?.revision||0,updatedAt:row?.updated_at||null,deliveryStatus:'not_connected'};}
  async function handle({req,user,readJson,send,getSession}){
    if(req.method==='GET'){send(200,get(user.id));return;}
    if(req.method!=='PUT')problem('提醒设置接口不支持此操作。',405);
    const body=await readJson(req,8192),active=getSession();
    if(!active||active.user.id!==user.id)problem('登录已失效，请重新登录。',401);
    if(active.user.mustChangePassword)problem('请先修改初始密码。',403);
    const settings=validateReminderSettings(body);
    // The synchronous read and write execute without yielding. No request can
    // overwrite a newer revision during this operation.
    if(body.revision!==get(user.id).revision)problem('设置已在其他页面更新，请读取最新设置后再调整。',409);
    db.prepare("INSERT INTO reminder_settings(user_id,settings_json) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET settings_json=excluded.settings_json,revision=reminder_settings.revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").run(user.id,JSON.stringify(settings));
    send(200,get(user.id));
  }
  return{get,handle};
}
