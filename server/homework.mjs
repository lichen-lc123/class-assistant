import {randomUUID,createHash} from 'node:crypto';
import {homeworkFromFile,imageMime,normalizeCourseName,noHomework} from './homework-files.mjs';
import {problem,validDate,validTime,todayShanghai} from './schedule.mjs';
import {reminderSettingsService} from './reminder-settings.mjs';
import {homeworkCompletionAction} from './homework-notification-actions.mjs';
const parse=v=>JSON.parse(v||'null'),hash=v=>createHash('sha256').update(v).digest('hex');
const text=(v,max=20000)=>{if(v==null)return'';if(typeof v!=='string'||v.length>max)problem('作业字段格式或长度不正确。');return v.trim();};
const keyOf=r=>hash([r.kind,normalizeCourseName(r.course_name),r.teacher,r.title].join('|'));
const normalizedTeacher=s=>String(s||'').replace(/\s/g,'');
export function compareHomework(a,b){const rank={high:0,normal:1,low:2},date=r=>r.planned_date||r.due_date||'9999-12-31',time=r=>(r.planned_date?r.planned_time:r.due_time)||'23:59';return Number(a.completed)-Number(b.completed)||(rank[a.priority||'normal']-rank[b.priority||'normal'])||date(a).localeCompare(date(b))||time(a).localeCompare(time(b))||a.title.localeCompare(b.title)||String(a.id||'').localeCompare(String(b.id||''));}
export function homeworkService(db,timetable){
  const reminderSettings=reminderSettingsService(db);
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}};
  function classOptions(termId){
    timetable.term(termId);const result=new Map(),publicRows=db.prepare('SELECT * FROM public_courses WHERE term_id=?').all(termId),masters=new Map(publicRows.map(r=>[r.id,r]));
    const add=(course,master)=>{const code=master?.class_code||course.teaching_class_code||'',id=master?.id||null;if(!code&&!id)return;const key=code?'code:'+code:'course:'+id;if(result.has(key))return;result.set(key,{key,classCode:code||null,courseId:id,courseName:course.course_name||'',teacher:course.teacher||'',label:`${course.course_name||'课程'} · ${course.teacher||'老师待确认'} · 上课班 ${code||'未编号'}`});};
    for(const row of publicRows)add(parse(row.payload_json),row);
    const entries=db.prepare('SELECT e.* FROM timetable_entries e JOIN timetables t ON t.id=e.timetable_id WHERE t.term_id=?').all(termId);
    for(const e of entries){const master=masters.get(e.course_id),course=master?parse(master.payload_json):parse(e.private_json);if(course)add(course,master);}
    return[...result.values()];
  }
  function ownClasses(userId,termId){const t=timetable.get(userId,termId);return t.courses.map(c=>({courseId:c.publicCourseId||null,classCode:c.teaching_class_code||null}));}
  function targets(id){return db.prepare('SELECT target_key AS key,course_id AS courseId,class_code AS classCode FROM homework_targets WHERE record_id=?').all(id);}
  function visible(row,userId){if(!row)return false;if(row.owner_id!=null)return row.owner_id===userId;if(!row.published)return false;const mine=ownClasses(userId,row.term_id);return targets(row.id).some(t=>mine.some(c=>t.courseId&&t.courseId===c.courseId||t.classCode&&t.classCode===c.classCode));}
  function getRecord(id){const row=db.prepare('SELECT * FROM homework_records WHERE id=?').get(id);if(!row)problem('作业记录不存在。',404);return row;}
  function view(row,userId,admin=false){
    const data=parse(row.payload_json),term=timetable.term(row.term_id),completion=db.prepare('SELECT completed_revision,updated_at FROM homework_completions WHERE user_id=? AND record_id=?').get(userId,row.id),completed=completion?.completed_revision===row.revision;
    const today=todayShanghai(),daysUntil=data.due_date?Math.round((Date.parse(data.due_date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000):null;
    const overdue=row.kind==='assignment'&&Boolean(data.due_date&&(data.due_date<today||data.due_date===today&&data.due_time&&Date.now()>Date.parse(data.due_date+'T'+data.due_time+':00+08:00')));
    const attachments=db.prepare('SELECT a.asset_id AS assetId,a.field,a.caption,b.mime FROM homework_attachments a JOIN homework_assets b ON b.id=a.asset_id WHERE a.record_id=?').all(row.id).map(a=>({...a,url:`/api/homework/assets/${a.assetId}?recordId=${row.id}`}));
    if(!admin)delete data.source_rows;
    const preferences=db.prepare('SELECT priority,planned_date,planned_time FROM homework_preferences WHERE user_id=? AND record_id=?').get(userId,row.id)||{priority:'normal',planned_date:null,planned_time:null};
    return{...data,...preferences,id:row.id,termId:row.term_id,sourceType:row.owner_id!=null?'personal':'class',canEdit:row.owner_id===userId,academicYear:term.academicYear,termName:term.name,kind:row.kind,title:row.title,published:Boolean(row.published),revision:row.revision,updatedAt:row.updated_at,completed,completedAt:completed?completion.updated_at:null,remindersSuppressed:completed,needsReconfirm:Boolean(completion&&!completed),overdue:overdue&&!completed,daysUntil,targets:targets(row.id),attachments};
  }
  // Every future sender must call this immediately before sending, including
  // retries. A candidate captured before completion is not a delivery permit.
  function reminderCandidate(userId,recordId,revision,type='deadline'){
    const row=db.prepare('SELECT * FROM homework_records WHERE id=?').get(recordId);
    if(!row||row.kind!=='assignment'||row.revision!==revision||!visible(row,userId))return null;
    const record=view(row,userId),settings=reminderSettings.get(userId);
    if(record.completed||!['deadline','update'].includes(type))return null;
    if(type==='deadline'&&(!settings.homeworkDueEnabled||!settings.remindOfficialDeadline&&!settings.remindPersonalPlan)||type==='update'&&!settings.homeworkUpdatesEnabled)return null;
    return{recordId:row.id,revision:row.revision,completeAction:homeworkCompletionAction(record)};
  }
  function personal(userId,termId){
    const rows=db.prepare(`SELECT * FROM homework_records WHERE (owner_id=? OR owner_id IS NULL AND published=1) ${termId?'AND term_id=?':''} ORDER BY created_at DESC`).all(userId,...(termId?[termId]:[]));
    return rows.filter(row=>visible(row,userId)).map(row=>view(row,userId)).sort(compareHomework);
  }
  function normalize(input,termId,privateRecord=false){
    if(!input||typeof input!=='object')problem('请填写作业内容。');const kind=input.kind;if(!['assignment','reference'].includes(kind))problem('请选择作业或考核说明。');
    const record={kind,title:text(input.title,160),course_name:text(input.course_name,160),teacher:text(input.teacher,100),content:text(input.content),submission:text(input.submission,4000),assessment_rules:text(input.assessment_rules),team_requirement:text(input.team_requirement,2000),notes:text(input.notes),deadline_raw:text(input.deadline_raw,2000),due_date:input.due_date||null,due_time:input.due_time||null,source:text(input.source,400),sequence:text(String(input.sequence??''),30),credits:text(String(input.credits??''),30),source_rows:Array.isArray(input.source_rows)?input.source_rows.slice(0,100):[],warnings:Array.isArray(input.warnings)?input.warnings.filter(x=>typeof x==='string').slice(0,40):[]};
    if(!record.title||!privateRecord&&(!record.course_name||!record.teacher))problem(privateRecord?'请填写个人作业标题。':'课程名称、任课老师和标题不能为空。');
    if(privateRecord&&(kind!=='assignment'||input.targetKeys?.length||input.attachments?.length))problem('个人作业不能发布给上课班或引用公共图片；请填写文字作业。');
    if(record.due_date&&!validDate(record.due_date)||record.due_time&&!validTime(record.due_time)||record.due_time&&!record.due_date)problem('截止日期或时间不正确；具体时间需要对应日期。');
    const options=new Map((privateRecord?[]:classOptions(termId)).map(o=>[o.key,o]));
    if(!Array.isArray(input.targetKeys)||input.targetKeys.length>100)problem('请选择适用上课班。');
    const chosen=[...new Set(input.targetKeys)].map(key=>{if(typeof key!=='string')problem('上课班无效。');const option=options.get(key);if(option)return option;const m=key.match(/^code:([A-Za-z0-9_-]{1,60})$/);if(m)return{key,classCode:m[1],courseId:null};problem('上课班不存在或不属于当前学期。');});
    const published=privateRecord||input.published===true;if(!privateRecord&&published&&!chosen.length)problem('发布前请明确适用上课班；尚未匹配时可先保存草稿。');
    const refs=Array.isArray(input.attachments)?input.attachments:[];if(refs.length>100)problem('附件数量过多。');
    const attachments=refs.map(a=>{if(!a||!/^[a-f0-9]{64}$/.test(a.assetId)||!['content','assessment_rules','notes','submission','team_requirement'].includes(a.field))problem('图片附件关联无效。');return{assetId:a.assetId,field:a.field,caption:text(a.caption,400)};});
    if(!privateRecord&&kind==='assignment'&&!record.content&&!attachments.some(a=>a.field==='content'))problem('作业需要文字内容或作业图片。');
    if(kind==='reference'&&!record.assessment_rules&&!record.notes&&!record.team_requirement&&!record.submission&&!attachments.length)problem('请填写课程考核或说明内容。');
    return{record,chosen,published,attachments,key:keyOf(record)};
  }
  function decodeAssets(input){
    if(input==null)return new Map();if(!Array.isArray(input)||input.length>100)problem('图片资料无效。');const assets=new Map();let total=0;
    for(const a of input){if(!a||typeof a.content!=='string'||a.content.length>3*1024*1024)problem('图片资料过大。');const bytes=Buffer.from(a.content,'base64'),mime=imageMime(bytes);total+=bytes.length;if(!mime||bytes.length>2*1024*1024||total>10*1024*1024||hash(bytes)!==a.id||a.mime!==mime)problem('图片资料校验失败。');assets.set(a.id,{bytes,mime});}return assets;
  }
  function writeLinks(id,item,assets){
    db.prepare('DELETE FROM homework_targets WHERE record_id=?').run(id);for(const t of item.chosen)db.prepare('INSERT INTO homework_targets VALUES(?,?,?,?)').run(id,t.key,t.courseId||null,t.classCode||null);
    db.prepare('DELETE FROM homework_attachments WHERE record_id=?').run(id);for(const a of item.attachments){const image=assets.get(a.assetId);if(image)db.prepare('INSERT OR IGNORE INTO homework_assets VALUES(?,?,?)').run(a.assetId,image.mime,image.bytes);if(!db.prepare('SELECT id FROM homework_assets WHERE id=?').get(a.assetId))problem('图片资料缺失，请重新导入原表。');db.prepare('INSERT OR IGNORE INTO homework_attachments VALUES(?,?,?,?)').run(id,a.assetId,a.field,a.caption);}
  }
  async function handle({req,path,url,user,readJson,send,getSession,res}){
    const admin=path.startsWith('/api/admin/');if(admin&&user.role!=='admin')problem('仅学委或管理员可以维护作业。',403);
    const read=async()=>{const body=await readJson(req,20*1024*1024),active=getSession();if(!active)problem('登录已失效，请重新登录。',401);if(admin&&active.user.role!=='admin')problem('管理权限已失效。',403);return body;};
    const assetPath=path.match(/^\/api\/homework\/assets\/([a-f0-9]{64})$/);
    if(assetPath&&req.method==='GET'){
      const row=getRecord(url.searchParams.get('recordId'));if(row.owner_id!=null?row.owner_id!==user.id:user.role!=='admin'&&!visible(row,user.id))problem('无权查看此作业附件。',403);
      if(!db.prepare('SELECT asset_id FROM homework_attachments WHERE record_id=? AND asset_id=?').get(row.id,assetPath[1]))problem('图片不属于此作业。',404);
      const asset=db.prepare('SELECT * FROM homework_assets WHERE id=?').get(assetPath[1]);if(!asset)problem('图片不存在。',404);res.writeHead(200,{'Content-Type':asset.mime,'Cache-Control':'private, no-store'});res.end(Buffer.from(asset.bytes));return;
    }
    if(path==='/api/homework'&&req.method==='GET'){
      const termId=url.searchParams.get('termId');if(termId)timetable.term(termId);const records=personal(user.id,termId);send(200,{records});return;
    }
    if(path==='/api/homework/summary'&&req.method==='GET'){
      const rows=personal(user.id).filter(r=>r.kind==='assignment'&&!r.completed);send(200,{pendingCount:rows.length,overdueCount:rows.filter(r=>r.overdue).length,records:rows.slice(0,3)});return;
    }
    const recordPath=path.match(/^\/api\/homework\/records\/([\w-]+)$/);
    if(recordPath&&req.method==='GET'){
      const row=getRecord(recordPath[1]);if(!visible(row,user.id))problem('此作业不属于你的个人作业或已选上课班。',403);send(200,view(row,user.id));return;
    }
    if(path==='/api/homework/personal'&&req.method==='POST'){
      const body=await read(),term=timetable.term(body.termId),item=normalize({...body.record,targetKeys:body.record?.targetKeys||[]},term.id,true),id=randomUUID();
      db.prepare('INSERT INTO homework_records(id,term_id,source_key,kind,title,payload_json,published,created_by,owner_id) VALUES(?,?,?,?,?,?,?,?,?)').run(id,term.id,'personal:'+user.id+':'+id,'assignment',item.record.title,JSON.stringify(item.record),1,user.id,user.id);
      send(201,view(getRecord(id),user.id));return;
    }
    const personalEdit=path.match(/^\/api\/homework\/personal\/([\w-]+)$/);
    if(personalEdit&&['PUT','DELETE'].includes(req.method)){
      const body=await read(),old=getRecord(personalEdit[1]);if(old.owner_id!==user.id)problem('只能修改或删除自己添加的个人作业。',403);if(Number(body.revision)!==old.revision)problem('个人作业已更新，请刷新后再操作。',409);
      if(req.method==='DELETE'){if(body.confirm!==true)problem('请确认删除个人作业。');db.prepare('DELETE FROM homework_records WHERE id=? AND owner_id=?').run(old.id,user.id);send(200,{ok:true});return;}
      const item=normalize({...body.record,targetKeys:body.record?.targetKeys||[]},old.term_id,true);
      db.prepare("UPDATE homework_records SET title=?,payload_json=?,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND owner_id=?").run(item.record.title,JSON.stringify(item.record),old.id,user.id);send(200,view(getRecord(old.id),user.id));return;
    }
    if(path==='/api/admin/homework/classes'&&req.method==='GET'){send(200,classOptions(url.searchParams.get('termId')));return;}
    if(path==='/api/admin/homework'&&req.method==='GET'){
      const termId=url.searchParams.get('termId');timetable.term(termId);send(200,{records:db.prepare('SELECT * FROM homework_records WHERE term_id=? AND owner_id IS NULL ORDER BY created_at DESC').all(termId).map(r=>view(r,user.id,true))});return;
    }
    if(path==='/api/admin/homework/preview'&&req.method==='POST'){
      const body=await read(),term=timetable.term(body.termId),parsed=homeworkFromFile(body.file,term),options=classOptions(term.id);
      const records=parsed.records.map((r,i)=>{const matches=options.filter(o=>normalizeCourseName(o.courseName)===normalizeCourseName(r.course_name)&&o.teacher.split(/[、,，/；;\s]+/).some(t=>normalizedTeacher(t)===normalizedTeacher(r.teacher)));const existing=db.prepare('SELECT id,payload_json FROM homework_records WHERE term_id=? AND source_key=?').get(term.id,keyOf(r));return{...r,previewId:'row-'+i,targetKeys:matches.length===1?[matches[0].key]:[],published:matches.length===1,matchCount:matches.length,existingId:existing?.id||null,warnings:[...r.warnings,...(matches.length===1?[]:[matches.length?'同名同老师有多个上课班，请明确选择。':'未匹配到上课班，将先保存草稿；请选择班级或填入准确班号。'])]};});send(200,{...parsed,records,classes:options});return;
    }
    if(path==='/api/admin/homework/import'&&req.method==='POST'){
      const body=await read(),term=timetable.term(body.termId);if(body.confirm!==true)problem('请核对导入预览并确认保存。');if(!Array.isArray(body.records)||!body.records.length||body.records.length>500)problem('每次需导入1—500条记录。');const assets=decodeAssets(body.assets),validRecords=body.records.filter(r=>!(r?.kind==='assignment'&&noHomework(r.content))),skippedEmpty=body.records.length-validRecords.length,items=validRecords.map(r=>normalize(r,term.id));let created=0,skipped=0,drafts=0;
      transaction(()=>{for(const item of items){if(db.prepare('SELECT id FROM homework_records WHERE term_id=? AND source_key=?').get(term.id,item.key)){skipped++;continue;}const id=randomUUID();db.prepare('INSERT INTO homework_records(id,term_id,source_key,kind,title,payload_json,published,created_by) VALUES(?,?,?,?,?,?,?,?)').run(id,term.id,item.key,item.record.kind,item.record.title,JSON.stringify(item.record),item.published?1:0,user.id);writeLinks(id,item,assets);created++;if(!item.published)drafts++;}});send(201,{created,skipped,skippedEmpty,drafts});return;
    }
    if(path==='/api/admin/homework/records'&&req.method==='POST'){
      const body=await read(),term=timetable.term(body.termId),item=normalize(body.record,term.id),assets=decodeAssets(body.assets);if(db.prepare('SELECT id FROM homework_records WHERE term_id=? AND source_key=?').get(term.id,item.key))problem('已有相同课程、老师和标题的记录，请编辑原记录。',409);const id=randomUUID();transaction(()=>{db.prepare('INSERT INTO homework_records(id,term_id,source_key,kind,title,payload_json,published,created_by) VALUES(?,?,?,?,?,?,?,?)').run(id,term.id,item.key,item.record.kind,item.record.title,JSON.stringify(item.record),item.published?1:0,user.id);writeLinks(id,item,assets);});send(201,view(getRecord(id),user.id,true));return;
    }
    const edit=path.match(/^\/api\/admin\/homework\/records\/([\w-]+)$/);
    if(edit&&['PUT','DELETE'].includes(req.method)){
      const body=await read(),old=getRecord(edit[1]);if(old.owner_id!=null)problem('个人作业仅能由本人通过个人入口维护。',403);if(Number(body.revision)!==old.revision)problem('记录已更新，请刷新后再操作。',409);
      if(req.method==='DELETE'){if(body.confirm!==true)problem('请确认删除该记录。');db.prepare('DELETE FROM homework_records WHERE id=?').run(old.id);send(200,{ok:true});return;}
      const item=normalize(body.record,old.term_id),assets=decodeAssets(body.assets);if(db.prepare('SELECT id FROM homework_records WHERE term_id=? AND source_key=? AND id<>?').get(old.term_id,item.key,old.id))problem('已有相同课程、老师和标题的记录。',409);
      transaction(()=>{db.prepare("UPDATE homework_records SET source_key=?,kind=?,title=?,payload_json=?,published=?,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(item.key,item.record.kind,item.record.title,JSON.stringify(item.record),item.published?1:0,old.id);writeLinks(old.id,item,assets);});send(200,view(getRecord(old.id),user.id,true));return;
    }
    const complete=path.match(/^\/api\/homework\/records\/([\w-]+)\/completion$/);
    const preferencesPath=path.match(/^\/api\/homework\/records\/([\w-]+)\/preferences$/);
    if(preferencesPath&&req.method==='PUT'){
      const body=await read(),row=getRecord(preferencesPath[1]);if(!visible(row,user.id)||row.kind!=='assignment')problem('仅能调整本人的个人作业或已选上课班作业。',403);if(Number(body.revision)!==row.revision)problem('作业已更新，请刷新后核对截止时间。',409);
      const priority=body.priority||'normal',plannedDate=body.planned_date||null,plannedTime=body.planned_time||null;
      if(!['high','normal','low'].includes(priority)||plannedDate&&!validDate(plannedDate)||plannedTime&&(!plannedDate||!validTime(plannedTime)))problem('个人优先级或计划完成时间无效。');
      db.prepare("INSERT INTO homework_preferences(user_id,record_id,priority,planned_date,planned_time) VALUES(?,?,?,?,?) ON CONFLICT(user_id,record_id) DO UPDATE SET priority=excluded.priority,planned_date=excluded.planned_date,planned_time=excluded.planned_time,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").run(user.id,row.id,priority,plannedDate,plannedTime);
      send(200,view(row,user.id));return;
    }
    if(complete&&req.method==='POST'){
      const body=await read(),row=getRecord(complete[1]);if(!visible(row,user.id)||row.kind!=='assignment')problem('此作业不属于本人的个人作业或已选上课班。',403);if(Number(body.revision)!==row.revision)problem('作业内容已更新，请刷新并核对后再标记完成。',409);if(typeof body.completed!=='boolean')problem('完成状态无效。');
      if(body.completed)db.prepare("INSERT INTO homework_completions(user_id,record_id,completed_revision) VALUES(?,?,?) ON CONFLICT(user_id,record_id) DO UPDATE SET completed_revision=excluded.completed_revision,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE homework_completions.completed_revision<>excluded.completed_revision").run(user.id,row.id,row.revision);else db.prepare('DELETE FROM homework_completions WHERE user_id=? AND record_id=?').run(user.id,row.id);send(200,view(row,user.id));return;
    }
    problem('作业接口不存在。',404);
  }
  return{handle,personal,classOptions,reminderCandidate};
}
