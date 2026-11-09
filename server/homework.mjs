import {randomUUID,createHash} from 'node:crypto';
import {homeworkFromFile,imageMime,normalizeCourseName,noHomework} from './homework-files.mjs';
import {problem,validDate,validTime,todayShanghai} from './schedule.mjs';
import {reminderSettingsService} from './reminder-settings.mjs';
import {homeworkCompletionAction} from './homework-notification-actions.mjs';
import {courseIdentity,courseTimeLabel} from './course-identity.mjs';
const parse=v=>JSON.parse(v||'null'),hash=v=>createHash('sha256').update(v).digest('hex');
const text=(v,max=20000)=>{if(v==null)return'';if(typeof v!=='string'||v.length>max)problem('作业字段格式或长度不正确。');return v.trim();};
const keyOf=r=>hash([r.kind,normalizeCourseName(r.course_name),r.teacher,r.title].join('|'));
const normalizedTeacher=s=>String(s||'').replace(/\s/g,'');
const normalizedText=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
function assignmentIdentity(r){
  const title=normalizedText(r.title),match=title.match(/第([\d一二三四五六七八九十百零两]+)次/);
  const number=value=>{if(/^\d+$/.test(value))return Number(value);let total=0,part=0;for(const c of value){if(c==='十'||c==='百'){total+=(part||1)*(c==='十'?10:100);part=0;}else part='零一二三四五六七八九'.indexOf(c==='两'?'二':c);}return total+part;};
  return JSON.stringify([r.kind,normalizeCourseName(r.course_name),normalizedText(r.teacher),r.kind==='assignment'&&match?'第'+number(match[1])+'次':title]);
}
export function compareHomework(a,b){
  const byState=Number(Boolean(a.completed))-Number(Boolean(b.completed));
  if(byState)return byState;
  const stable=()=>a.title.localeCompare(b.title)||String(a.id||'').localeCompare(String(b.id||''));
  if(a.completed&&b.completed)return String(b.completedAt||'').localeCompare(String(a.completedAt||''))||stable();
  const rank={high:0,normal:1,low:2},date=r=>r.planned_date||r.due_date||'9999-12-31',time=r=>(r.planned_date?r.planned_time:r.due_time)||'23:59';
  return(rank[a.priority||'normal']-rank[b.priority||'normal'])||date(a).localeCompare(date(b))||time(a).localeCompare(time(b))||stable();
}
export function homeworkService(db,timetable){
  const reminderSettings=reminderSettingsService(db);
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}};
  function classOptions(termId){
    const t=timetable.term(termId),result=new Map(),identities=new Set(),publicRows=db.prepare('SELECT * FROM public_courses WHERE term_id=? ORDER BY id').all(termId);
    const add=(course,master)=>{const identity=courseIdentity(course,t),id=master?.id||null;if(!id&&!identity)return;const key=id?'course:'+id:'identity:'+identity;if(result.has(key)||identity&&identities.has(identity))return;if(identity)identities.add(identity);result.set(key,{key,courseId:id,identityKey:identity,courseName:course.course_name||'',teacher:course.teacher||'',timeLabel:courseTimeLabel(course,t),label:`${course.course_name||'课程'} · ${course.teacher||'老师待确认'} · ${courseTimeLabel(course,t)}`});};
    for(const row of publicRows)add(parse(row.payload_json),row);
    const entries=db.prepare('SELECT e.* FROM timetable_entries e JOIN timetables tt ON tt.id=e.timetable_id WHERE tt.term_id=? AND e.course_id IS NULL').all(termId);
    for(const entry of entries){const course=parse(entry.private_json);if(course)add(course,null);}
    return [...result.values()];
  }
  function ownClasses(userId,termId){const t=timetable.get(userId,termId);return t.courses.map(c=>({entryId:c.id,courseId:c.publicCourseId||null,identityKey:courseIdentity(c,t.term)}));}
  function matchesCourse(row,course,t){
    if(row.owner_id!=null)return parse(row.payload_json).course_entry_id===course.entryId;
    return targets(row.id).some(target=>{
      const master=target.courseId?db.prepare('SELECT payload_json FROM public_courses WHERE id=? AND term_id=?').get(target.courseId,t.id):null;
      const identity=master?courseIdentity(parse(master.payload_json),t):target.identityKey;
      return Boolean(target.courseId&&target.courseId===course.courseId||identity&&identity===course.identityKey);
    });
  }
  function targets(id){return db.prepare('SELECT target_key,course_id AS courseId,identity_key AS identityKey FROM homework_targets WHERE record_id=?').all(id).map(row=>({courseId:row.courseId,identityKey:row.identityKey,key:row.courseId?'course:'+row.courseId:row.identityKey?'identity:'+row.identityKey:'legacy:'+hash(row.target_key)}));}
  function visible(row,userId){
    if(!row)return false;if(row.owner_id!=null)return row.owner_id===userId;if(!row.published)return false;
    const mine=ownClasses(userId,row.term_id),t=timetable.term(row.term_id);
    return targets(row.id).some(target=>{
      const master=target.courseId?db.prepare('SELECT payload_json FROM public_courses WHERE id=? AND term_id=?').get(target.courseId,t.id):null;
      const identity=master?courseIdentity(parse(master.payload_json),t):target.identityKey;
      return mine.some(course=>target.courseId&&target.courseId===course.courseId||identity&&identity===course.identityKey);
    });
  }
  function getRecord(id){const row=db.prepare('SELECT * FROM homework_records WHERE id=?').get(id);if(!row)problem('作业记录不存在。',404);return row;}
  function importExisting(termId,record){
    const matches=db.prepare('SELECT * FROM homework_records WHERE term_id=? AND owner_id IS NULL').all(termId).filter(row=>assignmentIdentity(parse(row.payload_json))===assignmentIdentity(record));
    if(matches.length>1)problem('存在多条相同课程、老师和作业次数的记录，请先处理重复记录。',409);
    return matches[0]||null;
  }
  function acknowledge(userId,row){db.prepare('INSERT INTO homework_reads(user_id,record_id,seen_revision) VALUES(?,?,?) ON CONFLICT(user_id,record_id) DO UPDATE SET seen_revision=MAX(seen_revision,excluded.seen_revision)').run(userId,row.id,row.revision);}
  function view(row,userId,admin=false){
    const data=parse(row.payload_json),term=timetable.term(row.term_id),completion=db.prepare('SELECT completed_revision,updated_at FROM homework_completions WHERE user_id=? AND record_id=?').get(userId,row.id);
    const defaults=row.kind==='assignment'&&row.owner_id==null?db.prepare('SELECT * FROM homework_completion_defaults WHERE record_id=?').get(row.id):null;
    const exception=defaults?db.prepare('SELECT generation FROM homework_completion_exceptions WHERE user_id=? AND record_id=?').get(userId,row.id):null;
    const defaultCompleted=Boolean(defaults&&exception?.generation!==defaults.generation);
    const completed=exception&&exception.generation===defaults?.generation?false:defaultCompleted||completion?.completed_revision===row.revision;
    const completedAt=completed?[...(defaultCompleted?[defaults.completed_at]:[]),...(completion?.completed_revision===row.revision?[completion.updated_at]:[])].sort().at(-1):null;
    const today=todayShanghai(),daysUntil=data.due_date?Math.round((Date.parse(data.due_date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000):null;
    const overdue=row.kind==='assignment'&&Boolean(data.due_date&&(data.due_date<today||data.due_date===today&&data.due_time&&Date.now()>Date.parse(data.due_date+'T'+data.due_time+':00+08:00')));
    const attachments=db.prepare('SELECT a.asset_id AS assetId,a.field,a.caption,b.mime,length(b.bytes) AS size FROM homework_attachments a JOIN homework_assets b ON b.id=a.asset_id WHERE a.record_id=?').all(row.id).map(a=>({...a,filename:data.attachment_names?.[a.assetId+':'+a.field]||'',url:`/api/homework/assets/${a.assetId}?recordId=${row.id}&field=${encodeURIComponent(a.field)}`}));
    delete data.attachment_names;
    if(!admin)delete data.source_rows;
    const preferences=db.prepare('SELECT priority,planned_date,planned_time FROM homework_preferences WHERE user_id=? AND record_id=?').get(userId,row.id)||{priority:'normal',planned_date:null,planned_time:null};
    const seen=db.prepare('SELECT seen_revision FROM homework_reads WHERE user_id=? AND record_id=?').get(userId,row.id);
    const audience=targets(row.id),draftReason=!row.published?(audience.length===0?'未匹配到课程，请先编辑并选择实际课程。':audience.length>1?'关联了多门课程，请先编辑并选择唯一课程。':'已保存为草稿，点击“发布”后同学才能查看。'):null;
    return{...data,...preferences,hasUpdates:!admin&&!defaultCompleted&&row.update_revision>(seen?.seen_revision||0),id:row.id,termId:row.term_id,sourceType:row.owner_id!=null?'personal':'class',canEdit:row.owner_id===userId,academicYear:term.academicYear,termName:term.name,kind:row.kind,title:row.title,published:Boolean(row.published),revision:row.revision,updatedAt:row.updated_at,completed,completedAt,remindersSuppressed:completed,needsReconfirm:Boolean(completion&&!completed),overdue:overdue&&!completed,daysUntil,targets:audience,attachments,...(admin?{allCompletedAt:defaults?.completed_at||null,allCompletedGeneration:defaults?.generation||0,draftReason}:{})};
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
    if(!privateRecord&&input.autoPublish===true){
      if(!Array.isArray(input.targetKeys)||input.targetKeys.length!==1)problem('请选择一门明确的课程，保存后自动发布给该课程的同学。');
      const course=classOptions(termId).find(c=>c.key===input.targetKeys[0]);
      if(!course)problem('课程不存在或不属于本学期，请重新选择。');
      input={...input,course_name:course.courseName,teacher:course.teacher,published:true};
    }
    const record={kind,title:text(input.title,160),course_name:text(input.course_name,160),teacher:text(input.teacher,100),content:text(input.content),submission:text(input.submission,4000),assessment_rules:text(input.assessment_rules),team_requirement:text(input.team_requirement,2000),notes:text(input.notes),deadline_raw:text(input.deadline_raw,2000),due_date:input.due_date||null,due_time:input.due_time||null,source:text(input.source,400),sequence:text(String(input.sequence??''),30),credits:text(String(input.credits??''),30),source_rows:Array.isArray(input.source_rows)?input.source_rows.slice(0,100):[],warnings:Array.isArray(input.warnings)?input.warnings.filter(x=>typeof x==='string').slice(0,40):[]};
    if(!record.title||!privateRecord&&(!record.course_name||!record.teacher))problem(privateRecord?'请填写个人作业标题。':'课程名称、任课老师和标题不能为空。');
    if(privateRecord&&(kind!=='assignment'||input.targetKeys?.length))problem('个人作业不能发布给其他课程。');
    if(record.due_date&&!validDate(record.due_date)||record.due_time&&!validTime(record.due_time)||record.due_time&&!record.due_date)problem('截止日期或时间不正确；具体时间需要对应日期。');
    const options=new Map((privateRecord?[]:classOptions(termId)).map(o=>[o.key,o]));
    if(!Array.isArray(input.targetKeys)||input.targetKeys.length>100)problem('请选择适用课程。');
    const chosen=[...new Set(input.targetKeys)].map(key=>{if(typeof key!=='string')problem('课程无效。');const option=options.get(key);if(option)return option;problem('课程不存在或不属于当前学期，请重新选择课程及其上课时间。');});
    const published=privateRecord||input.published===true;if(!privateRecord&&published&&!chosen.length)problem('发布前请选择适用课程并核对上课时间；尚未匹配时可先保存草稿。');
    const refs=Array.isArray(input.attachments)?input.attachments:[];if(refs.length>100)problem('附件数量过多。');
    const attachments=refs.map(a=>{if(!a||!/^[a-f0-9]{64}$/.test(a.assetId)||!['content','assessment_rules','notes','submission','team_requirement','attachment'].includes(a.field))problem('图片或附件关联无效。');return{assetId:a.assetId,field:a.field,caption:text(a.caption,400),filename:text(a.filename,200).replace(/[\x00-\x1f\x7f/\\]/g,'_')};});
    record.attachment_names=Object.fromEntries(attachments.filter(a=>a.filename).map(a=>[a.assetId+':'+a.field,a.filename]));
    if(!privateRecord&&kind==='assignment'&&!record.content&&!attachments.some(a=>['content','attachment'].includes(a.field)))problem('作业需要文字内容、图片或附件。');
    if(kind==='reference'&&!record.assessment_rules&&!record.notes&&!record.team_requirement&&!record.submission&&!attachments.length)problem('请填写课程考核或说明内容。');
    return{record,chosen,published,attachments,key:keyOf(record)};
  }
  function normalizePersonal(input,termId,userId,previous=null){
    const entryId=text(input?.course_entry_id,80),courses=timetable.get(userId,termId).courses;
    const course=entryId?courses.find(c=>c.id===entryId):null;
    // Existing private work remains editable if its course was later removed,
    // or it predates course selection. This exception cannot change its course.
    const keepPrevious=previous&&entryId===(previous.course_entry_id||'')&&
      text(input?.course_name,160)===(previous.course_name||'')&&text(input?.teacher,100)===(previous.teacher||'');
    if(!course&&!keepPrevious)problem(courses.length?'只能选择本人该学期课表中的课程，请从列表重新选择。':'本学期课表中还没有课程，请先到课表管理添加课程。');
    const item=normalize({...input,course_name:course?course.course_name:previous.course_name,teacher:course?(course.teacher||''):(previous?.teacher||'')},termId,true);
    item.record.course_entry_id=course?.id||previous?.course_entry_id||null;
    return item;
  }
  function decodeAssets(input){
    if(input==null)return new Map();if(!Array.isArray(input)||input.length>100)problem('图片或附件资料无效。');const assets=new Map();let total=0;
    for(const a of input){
      if(!a||typeof a.content!=='string'||a.content.length>14*1024*1024)problem('单个附件不能超过10 MB。');
      const bytes=Buffer.from(a.content,'base64'),image=imageMime(bytes),mime=image||'application/octet-stream';total+=bytes.length;
      if(!bytes.length||bytes.length>10*1024*1024||image&&bytes.length>5*1024*1024||total>20*1024*1024)problem('图片不能超过5 MB，附件不能超过10 MB，单次上传合计不能超过20 MB。');
      if(bytes.toString('base64')!==a.content||hash(bytes)!==a.id||(image?a.mime!==image:a.mime!=='application/octet-stream'))problem('图片或附件资料校验失败。');
      assets.set(a.id,{bytes,mime});
    }return assets;
  }
  function writeLinks(id,item,assets){
    db.prepare('DELETE FROM homework_targets WHERE record_id=?').run(id);for(const t of item.chosen)db.prepare('INSERT INTO homework_targets(record_id,target_key,course_id,class_code,identity_key) VALUES(?,?,?,NULL,?)').run(id,t.key,t.courseId||null,t.identityKey||null);
    const previous=new Set(db.prepare('SELECT asset_id FROM homework_attachments WHERE record_id=?').all(id).map(a=>a.asset_id));
    // A known content hash alone never grants permission to attach private data.
    // Existing files may only be retained on their original record; new files
    // must supply their own validated bytes in this request.
    let total=0;const counted=new Set();
    for(const a of item.attachments){const asset=assets.get(a.assetId);if(!asset&&!previous.has(a.assetId))problem('附件资料缺失或不属于此作业，请重新选择文件上传。');const stored=asset?null:db.prepare('SELECT mime,length(bytes) AS size FROM homework_assets WHERE id=?').get(a.assetId),mime=asset?.mime||stored?.mime;if(!counted.has(a.assetId)){total+=asset?.bytes.length||stored?.size||0;counted.add(a.assetId);}if(total>20*1024*1024)problem('本项作业的图片与附件合计不能超过20 MB。');}
    db.prepare('DELETE FROM homework_attachments WHERE record_id=?').run(id);for(const a of item.attachments){const file=assets.get(a.assetId);if(file)db.prepare('INSERT OR IGNORE INTO homework_assets VALUES(?,?,?)').run(a.assetId,file.mime,file.bytes);if(!db.prepare('SELECT id FROM homework_assets WHERE id=?').get(a.assetId))problem('附件资料缺失，请重新上传。');db.prepare('INSERT OR IGNORE INTO homework_attachments VALUES(?,?,?,?)').run(id,a.assetId,a.field,a.caption);}
  }
  async function handle({req,path,url,user,readJson,send,getSession,res}){
    const admin=path.startsWith('/api/admin/');if(admin&&user.role!=='admin')problem('仅学委或管理员可以维护作业。',403);
    const read=async()=>{const body=await readJson(req,32*1024*1024),active=getSession();if(!active)problem('登录已失效，请重新登录。',401);if(admin&&active.user.role!=='admin')problem('管理权限已失效。',403);return body;};
    const assetPath=path.match(/^\/api\/homework\/assets\/([a-f0-9]{64})$/);
    if(assetPath&&req.method==='GET'){
      const row=getRecord(url.searchParams.get('recordId'));if(row.owner_id!=null?row.owner_id!==user.id:user.role!=='admin'&&!visible(row,user.id))problem('无权查看此作业附件。',403);
      const field=url.searchParams.get('field');
      const link=db.prepare('SELECT * FROM homework_attachments WHERE record_id=? AND asset_id=?'+(field?' AND field=?':'')+' LIMIT 1').get(row.id,assetPath[1],...(field?[field]:[]));if(!link)problem('附件不属于此作业。',404);
      const asset=db.prepare('SELECT * FROM homework_assets WHERE id=?').get(assetPath[1]);if(!asset)problem('附件不存在。',404);
      const image=asset.mime.startsWith('image/'),name=parse(row.payload_json).attachment_names?.[asset.id+':'+link.field]||link.caption||(image?'作业图片.'+asset.mime.split('/')[1]:'作业附件');
      const disposition=!image||link.field==='attachment'||url.searchParams.get('download')==='1'?'attachment':'inline';
      res.writeHead(200,{'Content-Type':image?asset.mime:'application/octet-stream','Content-Disposition':`${disposition}; filename="homework-file"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g,'%27')}`,'Cache-Control':'private, no-store'});res.end(Buffer.from(asset.bytes));return;
    }
    if(path==='/api/homework'&&req.method==='GET'){
      const termId=url.searchParams.get('termId');if(termId)timetable.term(termId);let records=personal(user.id,termId);
      const entryId=url.searchParams.get('courseEntryId');
      if(entryId){if(!termId)problem('请选择课程所属学期。');const course=ownClasses(user.id,termId).find(c=>c.entryId===entryId);if(!course)problem('只能查看本人课表中的课程作业。',403);records=records.filter(r=>matchesCourse(getRecord(r.id),course,timetable.term(termId)));}
      send(200,{records});return;
    }
    if(path==='/api/homework/courses'&&req.method==='GET'){
      const termId=url.searchParams.get('termId');if(termId)timetable.term(termId);
      const tables=db.prepare('SELECT term_id FROM timetables WHERE user_id=?'+(termId?' AND term_id=?':'')).all(user.id,...(termId?[termId]:[]));
      const courses=tables.flatMap(row=>{const t=timetable.get(user.id,row.term_id);return t.courses.map(c=>({entryId:c.id,termId:row.term_id,courseName:c.course_name,teacher:c.teacher||'',timeLabel:courseTimeLabel(c,t.term)}));});send(200,{courses});return;
    }
    const coursePath=path.match(/^\/api\/homework\/course\/([\w-]+)$/);
    if(coursePath&&req.method==='GET'){
      const entry=db.prepare('SELECT e.id,tt.term_id FROM timetable_entries e JOIN timetables tt ON tt.id=e.timetable_id WHERE e.id=? AND tt.user_id=?').get(coursePath[1],user.id);
      if(!entry)problem('该课程不在你的课表中。',403);
      const table=timetable.get(user.id,entry.term_id),course=table.courses.find(c=>c.id===entry.id);if(!course)problem('该课程已移除，请刷新课表。',404);
      const own={entryId:course.id,courseId:course.publicCourseId,identityKey:courseIdentity(course,table.term)};
      const records=personal(user.id,entry.term_id).filter(r=>matchesCourse(getRecord(r.id),own,table.term));send(200,{course,records,term:table.term});return;
    }
    if(path==='/api/homework/summary'&&req.method==='GET'){
      const rows=personal(user.id).filter(r=>r.kind==='assignment'&&!r.completed);send(200,{pendingCount:rows.length,overdueCount:rows.filter(r=>r.overdue).length,records:rows.slice(0,4)});return;
    }
    const recordPath=path.match(/^\/api\/homework\/records\/([\w-]+)$/);
    if(recordPath&&req.method==='GET'){
      const row=getRecord(recordPath[1]);if(!visible(row,user.id))problem('此作业不属于你的个人作业或已选课程。',403);send(200,view(row,user.id));return;
    }
    if(path==='/api/homework/personal'&&req.method==='POST'){
      const body=await read(),term=timetable.term(body.termId),item=normalizePersonal({...body.record,targetKeys:body.record?.targetKeys||[]},term.id,user.id),assets=decodeAssets(body.assets),id=randomUUID();
      transaction(()=>{db.prepare('INSERT INTO homework_records(id,term_id,source_key,kind,title,payload_json,published,created_by,owner_id) VALUES(?,?,?,?,?,?,?,?,?)').run(id,term.id,'personal:'+user.id+':'+id,'assignment',item.record.title,JSON.stringify(item.record),1,user.id,user.id);writeLinks(id,item,assets);});
      send(201,view(getRecord(id),user.id));return;
    }
    const personalEdit=path.match(/^\/api\/homework\/personal\/([\w-]+)$/);
    if(personalEdit&&['PUT','DELETE'].includes(req.method)){
      const body=await read(),old=getRecord(personalEdit[1]);if(old.owner_id!==user.id)problem('只能修改或删除自己添加的个人作业。',403);if(Number(body.revision)!==old.revision)problem('个人作业已更新，请刷新后再操作。',409);
      if(req.method==='DELETE'){if(body.confirm!==true)problem('请确认删除个人作业。');db.prepare('DELETE FROM homework_records WHERE id=? AND owner_id=?').run(old.id,user.id);send(200,{ok:true});return;}
      const item=normalizePersonal({...body.record,targetKeys:body.record?.targetKeys||[]},old.term_id,user.id,parse(old.payload_json)),assets=decodeAssets(body.assets);
      transaction(()=>{db.prepare("UPDATE homework_records SET title=?,payload_json=?,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND owner_id=?").run(item.record.title,JSON.stringify(item.record),old.id,user.id);writeLinks(old.id,item,assets);});send(200,view(getRecord(old.id),user.id));return;
    }
    if(path==='/api/admin/homework/classes'&&req.method==='GET'){send(200,classOptions(url.searchParams.get('termId')));return;}
    if(path==='/api/admin/homework/batch-delete'&&req.method==='POST'){
      const body=await read();timetable.term(body.termId);
      if(body.confirm!==true||!Array.isArray(body.items)||!body.items.length||body.items.length>500)problem('请勾选 1—500 项作业并确认删除。');
      if(body.items.some(i=>!i||typeof i.id!=='string'||!Number.isInteger(i.revision)||i.revision<1))problem('作业记录或版本无效，请刷新后重试。');
      if(new Set(body.items.map(i=>i?.id)).size!==body.items.length)problem('不能重复选择同一条记录。');
      transaction(()=>{
        for(const item of body.items){const row=getRecord(item?.id);if(row.owner_id!=null||row.term_id!==body.termId)problem('只能删除当前学期的课程作业，不能删除个人作业。',403);if(row.revision!==Number(item.revision))problem('部分作业已更新，请刷新后重新勾选。',409);}
        for(const item of body.items)db.prepare('DELETE FROM homework_records WHERE id=?').run(item.id);
      });send(200,{deleted:body.items.length});return;
    }
    if(path==='/api/admin/homework'&&req.method==='GET'){
      const termId=url.searchParams.get('termId');timetable.term(termId);send(200,{records:db.prepare('SELECT * FROM homework_records WHERE term_id=? AND owner_id IS NULL ORDER BY created_at DESC').all(termId).map(r=>view(r,user.id,true))});return;
    }
    if(path==='/api/admin/homework/preview'&&req.method==='POST'){
      const body=await read(),term=timetable.term(body.termId),parsed=homeworkFromFile(body.file,term),options=classOptions(term.id);
      const records=parsed.records.map((r,i)=>{const matches=options.filter(o=>normalizeCourseName(o.courseName)===normalizeCourseName(r.course_name)&&o.teacher.split(/[、,，/；;\s]+/).some(t=>normalizedTeacher(t)===normalizedTeacher(r.teacher)));const existing=importExisting(term.id,r);return{...r,previewId:'row-'+i,targetKeys:matches.length===1?[matches[0].key]:[],published:matches.length===1,matchCount:matches.length,existingId:existing?.id||null,existingRevision:existing?.revision||null,warnings:[...r.warnings,...(matches.length===1?[]:[matches.length?'同名同老师有多个上课时间，请选择对应课程。':'未匹配到课程，将先保存草稿；请选择课程并核对教师和上课时间。'])]};});send(200,{...parsed,records,classes:options});return;
    }
    if(path==='/api/admin/homework/import'&&req.method==='POST'){
      const body=await read(),term=timetable.term(body.termId);if(body.confirm!==true)problem('请核对导入预览并确认保存。');if(!Array.isArray(body.records)||!body.records.length||body.records.length>500)problem('每次需导入1—500条记录。');const assets=decodeAssets(body.assets),validRecords=body.records.filter(r=>!(r?.kind==='assignment'&&noHomework(r.content))),skippedEmpty=body.records.length-validRecords.length;
      let created=0,updated=0,skipped=0,drafts=0;
      transaction(()=>{for(const input of validRecords){
        const old=importExisting(term.id,input);
        if(old&&input.existingRevision!=null&&Number(input.existingRevision)!==old.revision)problem('作业在预览后已被更新，请重新导入表格。',409);
        // An import updates published content, not the audience or personal state.
        const item=normalize(old?{...input,autoPublish:false,targetKeys:targets(old.id).map(t=>t.key),published:Boolean(old.published)}:input,term.id);
        if(old){
          const previous=parse(old.payload_json),fields=['kind','content','submission','assessment_rules','team_requirement','notes','due_date','due_time','deadline_raw','credits','attachment_names'];
          const oldAttachments=db.prepare('SELECT asset_id AS assetId,field,caption FROM homework_attachments WHERE record_id=? ORDER BY asset_id,field').all(old.id);
          const nextAttachments=item.attachments.map(({assetId,field,caption})=>({assetId,field,caption})).sort((a,b)=>a.assetId.localeCompare(b.assetId)||a.field.localeCompare(b.field));
          if(fields.every(k=>JSON.stringify(previous[k])===JSON.stringify(item.record[k]))&&JSON.stringify(oldAttachments)===JSON.stringify(nextAttachments)){skipped++;continue;}
          db.prepare("UPDATE homework_records SET title=?,payload_json=?,revision=revision+1,update_revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(item.record.title,JSON.stringify(item.record),old.id);
          db.prepare('UPDATE homework_completions SET completed_revision=? WHERE record_id=? AND completed_revision=?').run(old.revision+1,old.id,old.revision);
          writeLinks(old.id,item,assets);updated++;
        }else{
          const id=randomUUID();db.prepare('INSERT INTO homework_records(id,term_id,source_key,kind,title,payload_json,published,created_by) VALUES(?,?,?,?,?,?,?,?)').run(id,term.id,item.key,item.record.kind,item.record.title,JSON.stringify(item.record),item.published?1:0,user.id);
          writeLinks(id,item,assets);created++;if(!item.published)drafts++;
        }
      }});send(201,{created,updated,skipped,skippedEmpty,drafts});return;
    }
    if(path==='/api/admin/homework/records'&&req.method==='POST'){
      const body=await read(),term=timetable.term(body.termId),item=normalize(body.record,term.id),assets=decodeAssets(body.assets);if(db.prepare('SELECT id FROM homework_records WHERE term_id=? AND source_key=?').get(term.id,item.key))problem('已有相同课程、老师和标题的记录，请编辑原记录。',409);const id=randomUUID();transaction(()=>{db.prepare('INSERT INTO homework_records(id,term_id,source_key,kind,title,payload_json,published,created_by) VALUES(?,?,?,?,?,?,?,?)').run(id,term.id,item.key,item.record.kind,item.record.title,JSON.stringify(item.record),item.published?1:0,user.id);writeLinks(id,item,assets);});send(201,view(getRecord(id),user.id,true));return;
    }
    const publish=path.match(/^\/api\/admin\/homework\/records\/([\w-]+)\/publish$/);
    if(publish&&req.method==='POST'){
      const body=await read(),row=getRecord(publish[1]);
      if(row.owner_id!=null)problem('个人作业不能发布给其他同学。',403);
      if(Number(body.revision)!==row.revision)problem('记录已更新，请刷新后再发布。',409);
      if(row.published){send(200,view(row,user.id,true));return;}
      const current=view(row,user.id,true),item=normalize({...current,targetKeys:current.targets.map(t=>t.key),autoPublish:true},row.term_id);
      if(db.prepare('SELECT id FROM homework_records WHERE term_id=? AND source_key=? AND id<>?').get(row.term_id,item.key,row.id))problem('已有相同课程、老师和标题的记录，请先核对。',409);
      transaction(()=>{
        db.prepare("UPDATE homework_records SET source_key=?,payload_json=?,published=1,revision=revision+1,update_revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(item.key,JSON.stringify(item.record),row.id);
        writeLinks(row.id,item,new Map());
      });send(200,view(getRecord(row.id),user.id,true));return;
    }
    const completeAll=path.match(/^\/api\/admin\/homework\/records\/([\w-]+)\/complete-all$/);
    if(completeAll&&req.method==='POST'){
      const body=await read(),row=getRecord(completeAll[1]);
      if(row.owner_id!=null||row.kind!=='assignment'||!row.published)problem('仅能将已发布的课程作业标记为全部完成。',400);
      if(Number(body.revision)!==row.revision)problem('作业已更新，请刷新后再操作。',409);
      if(body.confirm!==true)problem('请确认将此作业设为全部完成。');
      transaction(()=>{
        const previous=db.prepare('SELECT generation FROM homework_completion_defaults WHERE record_id=?').get(row.id);
        if(Number(body.generation||0)!==(previous?.generation||0))problem('全员完成状态已更新，请刷新后再操作。',409);
        db.prepare("INSERT INTO homework_completion_defaults(record_id,generation,completed_at,updated_by) VALUES(?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?) ON CONFLICT(record_id) DO UPDATE SET generation=generation+1,completed_at=excluded.completed_at,updated_by=excluded.updated_by").run(row.id,user.id);
      });
      send(200,view(row,user.id,true));return;
    }
    const edit=path.match(/^\/api\/admin\/homework\/records\/([\w-]+)$/);
    if(edit&&['PUT','DELETE'].includes(req.method)){
      const body=await read(),old=getRecord(edit[1]);if(old.owner_id!=null)problem('个人作业仅能由本人通过个人入口维护。',403);if(Number(body.revision)!==old.revision)problem('记录已更新，请刷新后再操作。',409);
      if(req.method==='DELETE'){if(body.confirm!==true)problem('请确认删除该记录。');db.prepare('DELETE FROM homework_records WHERE id=?').run(old.id);send(200,{ok:true});return;}
      const item=normalize(body.record,old.term_id),assets=decodeAssets(body.assets);if(db.prepare('SELECT id FROM homework_records WHERE term_id=? AND source_key=? AND id<>?').get(old.term_id,item.key,old.id))problem('已有相同课程、老师和标题的记录。',409);
      transaction(()=>{db.prepare("UPDATE homework_records SET source_key=?,kind=?,title=?,payload_json=?,published=?,revision=revision+1,update_revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(item.key,item.record.kind,item.record.title,JSON.stringify(item.record),item.published?1:0,old.id);writeLinks(old.id,item,assets);});send(200,view(getRecord(old.id),user.id,true));return;
    }
    const readPath=path.match(/^\/api\/homework\/records\/([\w-]+)\/read$/);
    if(readPath&&req.method==='POST'){
      const body=await read(),row=getRecord(readPath[1]);if(!visible(row,user.id))problem('无权查看此作业。',403);
      if(Number(body.revision)!==row.revision)problem('作业刚刚又有更新，请刷新后查看。',409);
      acknowledge(user.id,row);send(200,view(row,user.id));return;
    }
    const complete=path.match(/^\/api\/homework\/records\/([\w-]+)\/completion$/);
    const preferencesPath=path.match(/^\/api\/homework\/records\/([\w-]+)\/preferences$/);
    if(preferencesPath&&req.method==='PUT'){
      const body=await read(),row=getRecord(preferencesPath[1]);if(!visible(row,user.id)||row.kind!=='assignment')problem('仅能调整本人的个人作业或已选课程作业。',403);if(Number(body.revision)!==row.revision)problem('作业已更新，请刷新后核对截止时间。',409);
      const priority=body.priority||'normal',plannedDate=body.planned_date||null,plannedTime=body.planned_time||null;
      if(!['high','normal','low'].includes(priority)||plannedDate&&!validDate(plannedDate)||plannedTime&&(!plannedDate||!validTime(plannedTime)))problem('个人优先级或计划完成时间无效。');
      db.prepare("INSERT INTO homework_preferences(user_id,record_id,priority,planned_date,planned_time) VALUES(?,?,?,?,?) ON CONFLICT(user_id,record_id) DO UPDATE SET priority=excluded.priority,planned_date=excluded.planned_date,planned_time=excluded.planned_time,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").run(user.id,row.id,priority,plannedDate,plannedTime);
      send(200,view(row,user.id));return;
    }
    if(complete&&req.method==='POST'){
      const body=await read(),row=getRecord(complete[1]);if(!visible(row,user.id)||row.kind!=='assignment')problem('此作业不属于本人的个人作业或已选课程。',403);if(Number(body.revision)!==row.revision)problem('作业内容已更新，请刷新并核对后再标记完成。',409);if(typeof body.completed!=='boolean')problem('完成状态无效。');
      transaction(()=>{
        if(body.completed){
          db.prepare('DELETE FROM homework_completion_exceptions WHERE user_id=? AND record_id=?').run(user.id,row.id);
          db.prepare("INSERT INTO homework_completions(user_id,record_id,completed_revision) VALUES(?,?,?) ON CONFLICT(user_id,record_id) DO UPDATE SET completed_revision=excluded.completed_revision,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE homework_completions.completed_revision<>excluded.completed_revision").run(user.id,row.id,row.revision);acknowledge(user.id,row);
        }else{
          db.prepare('DELETE FROM homework_completions WHERE user_id=? AND record_id=?').run(user.id,row.id);
          const defaults=db.prepare('SELECT generation FROM homework_completion_defaults WHERE record_id=?').get(row.id);
          if(defaults)db.prepare('INSERT INTO homework_completion_exceptions(user_id,record_id,generation) VALUES(?,?,?) ON CONFLICT(user_id,record_id) DO UPDATE SET generation=excluded.generation').run(user.id,row.id,defaults.generation);
        }
      });send(200,view(row,user.id));return;
    }
    problem('作业接口不存在。',404);
  }
  return{handle,personal,classOptions,reminderCandidate};
}
