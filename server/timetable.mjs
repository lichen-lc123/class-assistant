import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { problem, trim, validateTerm, normalizeCourse, expandCourse, findConflicts, todayShanghai, matchesSemester } from './schedule.mjs';
import { calendarImport } from './academic-calendar.mjs';
import { academicCalendarWarnings } from '../shared/academic-calendar.mjs';
import { parseAiTimetable } from './ai-timetable.mjs';
import {buildTimetablePrompt} from './timetable-prompt.mjs';
import {numberLessons} from '../shared/lesson-order.mjs';
import { importConflicts,importConflictMessage } from './import-conflicts.mjs';
import { upcomingClassDays } from './dashboard.mjs';
import { templateImportService } from './template-import.mjs';
import { courseIdentity } from './course-identity.mjs';
import {semesterCalendarConfig} from '../shared/course-week.mjs';

const SOURCES=['ai','template','cards'];
const NOW="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const json=value=>JSON.stringify(value);
const parse=value=>JSON.parse(value||'null');
const hash=value=>createHash('sha256').update(json(value)).digest('hex');
const templateSelectionVersion=(template,t,courses)=>hash({term:[t.id,t.revision],template:[template.id,template.revision],courses:courses.map(c=>[c.id,c.revision])});
const cleanPrivate=payload=>Object.fromEntries(Object.entries(payload).filter(([,v])=>v!=null&&v!==''&&(!Array.isArray(v)||v.length)));
export function timetableService(db,{onCoursesChanged=()=>{}}={}) {
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  function term(id){const row=db.prepare('SELECT * FROM terms WHERE id = ?').get(id);if(!row)problem('学期不存在，请先由管理员建立学期。',404);return{id:row.id,academicYear:row.academic_year,name:row.name,startsOn:row.starts_on,endsOn:row.ends_on,config:semesterCalendarConfig(parse(row.config_json),row.starts_on,row.ends_on),revision:row.revision,updatedAt:row.updated_at};}
  const table=(userId,termId)=>db.prepare('SELECT * FROM timetables WHERE user_id = ? AND term_id = ?').get(userId,termId);
  const master=id=>db.prepare('SELECT * FROM public_courses WHERE id = ?').get(id);
  const matchingMaster=(course,t,published=false,excludeId=null)=>{const key=courseIdentity(course,t);if(!key)return null;return db.prepare(`SELECT * FROM public_courses WHERE term_id=? ${published?'AND published=1':''} ORDER BY id`).all(t.id).find(row=>row.id!==excludeId&&courseIdentity(parse(row.payload_json),t)===key)||null;};
  const templateLinks=e=>db.prepare('SELECT template_id FROM timetable_entry_templates WHERE entry_id=?').all(e.id);
  const templateChoice=(tt,templateId,courseId)=>db.prepare('SELECT action FROM timetable_template_course_choices WHERE timetable_id=? AND template_id=? AND course_id=?').get(tt.id,templateId,courseId)?.action;
  function rememberChoice(tt,templateId,courseId,action){db.prepare('INSERT INTO timetable_template_course_choices VALUES(?,?,?,?) ON CONFLICT(timetable_id,template_id,course_id) DO UPDATE SET action=excluded.action').run(tt.id,templateId,courseId,action);}
  function preserveTemplateEdit(e,t){
    const links=templateLinks(e);if(!e.course_id||!links.length)return;
    if(!e.base_snapshot_json){const base=entryView({...e,override_json:null},t),snapshot=normalizeCourse({...base,weekly_rules:[],special_dates:[],explicit_sessions:base.sessions},t);db.prepare('UPDATE timetable_entries SET base_snapshot_json=?,base_revision=? WHERE id=?').run(json(snapshot),base.publicRevision,e.id);}
    for(const {template_id} of links)if(templateChoice({id:e.timetable_id},template_id,e.course_id)!=='edited')rememberChoice({id:e.timetable_id},template_id,e.course_id,'edited');
  }
  function preserveLegacyChoices(tt,template){
    // Infer older choices only against the exact version that was selected.
    // A stale subscription with missing members still needs normal backfill.
    const subscription=db.prepare('SELECT template_revision FROM timetable_template_subscriptions WHERE timetable_id=? AND template_id=?').get(tt.id,template.id);
    const linked=db.prepare('SELECT e.* FROM timetable_entries e JOIN timetable_entry_templates et ON et.entry_id=e.id WHERE e.timetable_id=? AND et.template_id=?').all(tt.id,template.id);
    for(const e of linked)if(e.override_json)preserveTemplateEdit(e,term(tt.term_id));
    if(subscription?.template_revision===template.revision)for(const c of templateCourses(template,term(tt.term_id))){
      if(!templateChoice(tt,template.id,c.id)&&!db.prepare('SELECT 1 FROM timetable_entries WHERE timetable_id=? AND course_id=? LIMIT 1').get(tt.id,c.id))rememberChoice(tt,template.id,c.id,'removed');
    }
  }
  function preserveLegacyEditsForCourse(courseId){for(const e of db.prepare('SELECT DISTINCT e.*,tt.term_id FROM timetable_entries e JOIN timetable_entry_templates et ON et.entry_id=e.id JOIN timetables tt ON tt.id=e.timetable_id WHERE e.course_id=? AND e.override_json IS NOT NULL').all(courseId))preserveTemplateEdit(e,term(e.term_id));}
  function syncTemplateMembers(tt,template){
    const subscription=db.prepare('SELECT * FROM timetable_template_subscriptions WHERE timetable_id=? AND template_id=?').get(tt.id,template.id);
    if(!subscription||tt.term_id!==template.term_id)return;
    if(!db.isTransaction)return transaction(()=>syncTemplateMembers(tt,template));
    preserveLegacyChoices(tt,template);
    if(subscription.template_revision===template.revision)return;
    const sync=()=>{
      const members=templateCourses(template,term(tt.term_id)),selected=new Set(members.map(c=>c.id));
      const linked=db.prepare('SELECT e.* FROM timetable_entries e JOIN timetable_entry_templates et ON et.entry_id=e.id WHERE e.timetable_id=? AND et.template_id=?').all(tt.id,template.id);
      for(const entry of linked)if(!selected.has(entry.course_id)){
        if(templateChoice(tt,template.id,entry.course_id)==='edited')continue;
        db.prepare('DELETE FROM timetable_entry_templates WHERE entry_id=? AND template_id=?').run(entry.id,template.id);
        if(!entry.direct_source&&!db.prepare('SELECT entry_id FROM timetable_entry_templates WHERE entry_id=? LIMIT 1').get(entry.id))db.prepare('DELETE FROM timetable_entries WHERE id=?').run(entry.id);
      }
      for(const c of members){
        if(templateChoice(tt,template.id,c.id))continue;
        const linkedEntry=db.prepare('SELECT e.* FROM timetable_entries e JOIN timetable_entry_templates et ON et.entry_id=e.id WHERE e.timetable_id=? AND e.course_id=? AND et.template_id=? LIMIT 1').get(tt.id,c.id,template.id);
        const key=courseIdentity(c,term(tt.term_id));
        const entry=linkedEntry||db.prepare('SELECT * FROM timetable_entries WHERE timetable_id=? AND course_id=?').all(tt.id,c.id).find(e=>key&&courseIdentity(entryView(e,term(tt.term_id)),term(tt.term_id))===key);
        const snapshot=c.origin==='manual'?json(normalizeCourse(c,term(tt.term_id))):null;
        const entryId=entry?.id||insertEntry(tt,c.id,null,null,snapshot);
        if(entry)db.prepare('UPDATE timetable_entries SET base_snapshot_json=? WHERE id=?').run(snapshot,entry.id);
        db.prepare('INSERT OR IGNORE INTO timetable_entry_templates VALUES (?,?)').run(entryId,template.id);
      }
      db.prepare('UPDATE timetable_template_subscriptions SET template_revision=? WHERE timetable_id=? AND template_id=?').run(template.revision,tt.id,template.id);
      db.prepare('UPDATE timetables SET template_revision=CASE WHEN template_id=? THEN ? ELSE template_revision END,revision=revision+1 WHERE id=?').run(template.id,template.revision,tt.id);
    };
    if(db.isTransaction)sync();else transaction(sync);
  }
  function courseView(row,t,payload=null){const c=payload||parse(row.payload_json);
    const fromTemplate=row.origin==='template'||Boolean(db.prepare('SELECT 1 FROM template_courses WHERE course_id=? LIMIT 1').get(row.id));
    const creationSources=[...(fromTemplate?['template']:[]),...(row.origin==='manual'?['manual']:[])];
    return{...c,id:row.id,termId:row.term_id,origin:row.origin,creationSources,cardEnabled:Boolean(row.card_enabled),published:Boolean(row.published),revision:row.revision,updatedAt:row.updated_at,...expandCourse(c,t)};}
  function templateCourses(template,t){return db.prepare('SELECT c.*,tc.course_snapshot_json FROM template_courses tc JOIN public_courses c ON c.id=tc.course_id WHERE tc.template_id=? AND c.term_id=? ORDER BY c.id').all(template.id,t.id).map(row=>courseView(row,t,row.course_snapshot_json?parse(row.course_snapshot_json):null));}
  function entryView(row,t){
    const pub=row.course_id?master(row.course_id):null;
    const base=row.base_snapshot_json?parse(row.base_snapshot_json):pub?parse(pub.payload_json):{};
    const personal=parse(row.private_json)||{};const override=parse(row.override_json);
    const legacyOverride=override&&!('room_overrides' in override)?override:{};
    const merged={...base,...cleanPrivate(personal),...legacyOverride,warnings:[...new Set([...(base.warnings||[]),...(personal.warnings||[])])]};
    const c=normalizeCourse(merged,t);
    let expanded=expandCourse(c,t),display=c;
    if(override&&'room_overrides' in override){
      const defaultSessions=expanded.sessions;
      if(override.time_override){display=normalizeCourse({...c,weekly_rules:[],special_dates:[],explicit_sessions:override.time_override},t);expanded=expandCourse(display,t);}
      expanded.sessions=expanded.sessions.map((s,i)=>({...s,room:s.kind==='practice'?null:Object.hasOwn(override.room_overrides,String(i))?override.room_overrides[String(i)]:defaultSessions[i]?.room??c.room??null}));
      if(override.base_session_count!==defaultSessions.length)expanded.warnings.push('公共或导入安排的课次数量已变化，请重新核对个人修改对应的课次。');
    }
    const templateSyncPaused=Boolean(override&&row.base_snapshot_json);
    return{...display,id:row.id,publicCourseId:row.course_id,publicRevision:row.base_snapshot_json?row.base_revision:pub?.revision||0,hasOverride:Boolean(override),templateSyncPaused,hasPersonalData:Boolean(row.private_json),publicChanged:Boolean(pub&&!row.base_snapshot_json&&pub.revision>row.base_revision),...expanded};
  }
  function get(userId,termId){const t=term(termId);let tt=table(userId,termId);
    if(tt){for(const template of db.prepare('SELECT tpl.* FROM timetable_templates tpl JOIN timetable_template_subscriptions sub ON sub.template_id=tpl.id WHERE sub.timetable_id=?').all(tt.id))syncTemplateMembers(tt,template);tt=table(userId,termId);}
    const courses=tt?db.prepare('SELECT * FROM timetable_entries WHERE timetable_id = ? ORDER BY rowid').all(tt.id).map(r=>entryView(r,t)):[];
    return{term:t,timetable:tt?{id:tt.id,source:tt.source,revision:tt.revision,templateId:tt.template_id,templateRevision:tt.template_revision}:null,courses,conflicts:findConflicts(courses),today:todayShanghai(),serverNow:new Date().toISOString()};}
  function sourceCheck(userId,termId,source){if(!SOURCES.includes(source))problem('请选择 AI、模板或课程卡片导入。');get(userId,termId);return table(userId,termId);}
  function checkImport(userId,t,preview){
    const existing=get(userId,t.id).courses;
    const other=db.prepare('SELECT term_id FROM timetables WHERE user_id=? AND term_id<>?').all(userId,t.id).flatMap(row=>get(userId,row.term_id).courses);
    const conflicts=importConflicts([...existing,...other],preview.courses);
    const duplicate=preview.courses.find(c=>existing.some(e=>{const a=courseIdentity(c,t),b=courseIdentity(e,t);return a&&b?a===b:!a&&!b&&e.publicCourseId&&e.publicCourseId===c.id;}));
    const error=importConflictMessage(conflicts)||(duplicate?'课程已存在，不能重复导入：“'+duplicate.course_name+'”。':null);
    return{...preview,importConflicts:conflicts,importBlocked:Boolean(error),importError:error};
  }
  function requireImport(userId,t,preview){const result=checkImport(userId,t,preview);if(result.importBlocked)problem(result.importError,409);return result;}
  function checkRevision(tt,expected){if((tt?.revision||0)!==Number(expected||0))problem('课表已在其他页面更新，请刷新后重试，避免覆盖个人修改。',409);}
  function prepare(body,t){
    let raw,topWarnings=[];
    if(body.courses){raw={courses:body.courses,unparsed_items:body.unparsedItems,warnings:body.importWarnings};}
    else{
      raw=typeof body.text==='string'?parseAiTimetable(body.text):body.data;
      if(!raw||raw.schema_version!=='timetable.v1'||!Array.isArray(raw.courses))problem('AI 结果格式不正确，需要 schema_version=timetable.v1 和 courses 数组，请使用网站提供的提示词。');
    }
    if(!raw?.courses?.length||raw.courses.length>200)problem('请提供 1—200 条课程。');
    if(raw.academic_year&&raw.academic_year!==t.academicYear)problem('AI 结果学年与所选学年不一致。');
    if(raw.semester&&!matchesSemester(raw.semester,t))problem('AI 结果学期与所选学期不一致，请分别导入。');
    if(raw.unparsed_items!=null&&(!Array.isArray(raw.unparsed_items)||raw.unparsed_items.length>200))problem('未解析内容需为不超过200项的数组。');
    const unparsedItems=(raw.unparsed_items||[]).map(item=>({raw:trim(typeof item==='string'?item:item?.raw||JSON.stringify(item),8000),reason:trim(item?.reason,2000)||null}));
    if(unparsedItems.length)topWarnings.push(`还有 ${unparsedItems.length} 条内容未纳入课表，请展开核对原文和原因。`);
    const importWarnings=(Array.isArray(raw.warnings)?raw.warnings:[]).filter(s=>typeof s==='string').slice(0,30);
    topWarnings.push(...importWarnings);
    const result=[],seen=new Map(),uncoded=new Set();
    for(const item of raw.courses){
      const c=normalizeCourse({...item,academic_year:item.academic_year||raw.academic_year,semester:item.semester||raw.semester},t);
      const key=courseIdentity(c,t);
      if(key&&seen.has(key)){
        const previous=result[seen.get(key)];previous.source_rows.push(...c.source_rows);
        const weeklyOffset=previous.weekly_rules.length,specialOffset=previous.special_dates.length;
        const incomingResolutions=(c.extra_fields['周次日期冲突处理']||[]).map(r=>({...r,...(r.weekly_rule_index?{weekly_rule_index:r.weekly_rule_index+weeklyOffset}:{}),...(r.special_date_index?{special_date_index:r.special_date_index+specialOffset}:{})}));
        previous.weekly_rules.push(...c.weekly_rules);previous.special_dates.push(...c.special_dates);previous.explicit_sessions.push(...c.explicit_sessions);
        previous.warnings.push(...c.warnings);previous.source_warnings.push(...c.source_warnings);
        if(c.schedule_raw&&!previous.schedule_raw.includes(c.schedule_raw))previous.schedule_raw+='\n'+c.schedule_raw;
        if(c.remarks_raw&&!previous.remarks_raw.includes(c.remarks_raw))previous.remarks_raw+='\n'+c.remarks_raw;
        if(incomingResolutions.length)previous.extra_fields['周次日期冲突处理']=[...(previous.extra_fields['周次日期冲突处理']||[]),...incomingResolutions];
        for(const [field,value]of Object.entries(c.extra_fields)){if(field==='周次日期冲突处理')continue;if(field==='日期说明'&&Array.isArray(value)){previous.extra_fields[field]=[...(Array.isArray(previous.extra_fields[field])?previous.extra_fields[field]:[]),...value];}else if(!Object.hasOwn(previous.extra_fields,field))previous.extra_fields={...previous.extra_fields,[field]:value};else if(json(previous.extra_fields[field])!==json(value))previous.extra_fields['重复行附加信息']=[...(Array.isArray(previous.extra_fields['重复行附加信息'])?previous.extra_fields['重复行附加信息']:[]),{[field]:value}];}
        topWarnings.push(`${c.course_name} 出现名称、老师及时间重复的记录，已整理在同一条中，请核对安排。`);continue;
      }
      if(key)seen.set(key,result.length);
      else{const candidate=hash({name:c.course_name,teacher:c.teacher});if(uncoded.has(candidate))topWarnings.push(`${c.course_name} 的老师或时间未完整确定，疑似重复记录已分别保留，请核对。`);uncoded.add(candidate);}
      result.push(c);
    }
    const courses=result.map((c,index)=>{const match=matchingMaster(c,t,true);return{...c,id:'preview-'+index,matchedCourseId:match?.id||null,...expandCourse(c,t)};});
    return{courses,warnings:[...new Set(topWarnings)],conflicts:findConflicts(courses),unparsedItems,importWarnings};
  }
  const warningsPresent=p=>p.warnings?.length||p.conflicts?.length||p.courses.some(c=>c.warnings.length);
  function requireReview(p,body){if(warningsPresent(p)&&body.acceptWarnings!==true)problem('预览中有缺失、重复或时间冲突，请核对并勾选确认后保存。');}
  const templateImporter=templateImportService(db,{term,prepare,requireReview,onCoursesChanged});
  function selectedCourses(ids,t,cardOnly=false,existingIds=[]){
    if(!Array.isArray(ids)||!ids.length||ids.length>200)problem('请选择 1—200 门课程。');
    return [...new Set(ids)].map(id=>{const c=master(id);if(!c||c.term_id!==t.id||(!existingIds.includes(id)&&(!c.published||(cardOnly&&!c.card_enabled))))problem('选择中包含其他学期、已下架或未生成卡片的课程，请刷新后重新选择。');return courseView(c,t);});
  }
  function insertEntry(tt,publicId,personal=null,directSource=null,snapshot=null){const m=publicId?master(publicId):null,id=randomUUID();db.prepare('INSERT INTO timetable_entries (id,timetable_id,course_id,private_json,base_revision,direct_source,base_snapshot_json) VALUES (?,?,?,?,?,?,?)').run(id,tt.id,publicId,personal?json(personal):null,m?.revision||0,directSource,snapshot);return id;}
  function bump(tt){db.prepare('UPDATE timetables SET revision = revision + 1 WHERE id = ?').run(tt.id);}
  function newTable(userId,t,source,template=null){const id=randomUUID();db.prepare('INSERT INTO timetables (id,user_id,term_id,source,template_id,template_revision) VALUES (?,?,?,?,?,?)').run(id,userId,t.id,source,template?.id||null,template?.revision||null);return table(userId,t.id);}
  async function handle({req,path,url,user,readJson,send,getSession}) {
    const adminPath=path.startsWith('/api/admin/');
    if(adminPath&&user.role!=='admin')problem('仅管理员可以维护公共课程、卡片、模板和学期。',403);
    const read=async()=>{const body=await readJson(req,10*1024*1024);if(body.source==='excel')problem('课表已取消 Excel 导入，请使用 AI 整理导入。');const current=getSession();if(!current)problem('登录已失效，请重新登录。',401);if(adminPath&&current.user.role!=='admin')problem('管理权限已失效。',403);return body;};
    if(path==='/api/timetable/dashboard'&&req.method==='GET'){
      const tables=db.prepare('SELECT term_id FROM timetables WHERE user_id=?').all(user.id).map(row=>get(user.id,row.term_id));
      send(200,upcomingClassDays(tables,todayShanghai(),{mobile:url.searchParams.get('view')==='mobile'}));return;
    }
    if(path==='/api/timetable/terms'&&req.method==='GET'){
      const terms=db.prepare('SELECT id FROM terms ORDER BY academic_year DESC, starts_on DESC, name').all().map(r=>term(r.id));const today=todayShanghai();send(200,{terms,currentTermIds:terms.filter(t=>t.startsOn&&t.startsOn<=today&&t.endsOn>=today).map(t=>t.id),today,timeZone:'Asia/Shanghai'});return;
    }
    if(path==='/api/timetable/prompt'&&req.method==='GET'){
      const text=readFileSync(new URL('../需求文档/讨论稿/课表AI解析提示词.md',import.meta.url),'utf8'),base=text.slice(text.indexOf('你是课表数据整理助手。'));
      const termId=url.searchParams.get('termId');send(200,{text:termId?buildTimetablePrompt(base,term(termId)):base});return;
    }
    if(path==='/api/admin/timetable/calendar-prompt'&&req.method==='GET'){
      send(200,{text:readFileSync(new URL('../需求文档/课表功能/校历AI提取提示词.md',import.meta.url),'utf8')});return;
    }
    if(path==='/api/admin/timetable/calendar-example'&&req.method==='GET'){
      send(200,JSON.parse(readFileSync(new URL('../需求文档/课表功能/校历示例-2026秋冬.json',import.meta.url),'utf8')));return;
    }
    if(path==='/api/admin/timetable/calendar-preview'&&req.method==='POST'){
      const t=calendarImport(await read(),validateTerm);send(200,{term:t,warnings:academicCalendarWarnings(t)});return;
    }
    if(path==='/api/admin/timetable/terms'&&req.method==='POST'){
      const body=await read(),t=validateTerm(body),id=randomUUID();
      if(t.config.schoolCalendar&&body.calendarConfirmed!==true)problem('请先核对校历表格并勾选确认，再保存学期。');
      if(db.prepare('SELECT id FROM terms WHERE academic_year=? AND name=?').get(t.academicYear,t.name))problem('该学年下的学期名称已存在。',409);
      db.prepare('INSERT INTO terms (id,academic_year,name,starts_on,ends_on,config_json) VALUES (?,?,?,?,?,?)').run(id,t.academicYear,t.name,t.startsOn,t.endsOn,json(t.config));send(201,term(id));return;
    }
    const termEdit=path.match(/^\/api\/admin\/timetable\/terms\/([\w-]+)$/);
    if(termEdit&&req.method==='PUT'){
      const body=await read(),old=term(termEdit[1]),t=validateTerm(body);if(Number(body.revision)!==old.revision)problem('学期配置已更新，请刷新后再保存。',409);
      if(t.config.schoolCalendar&&body.calendarConfirmed!==true)problem('请先核对校历表格并勾选确认，再保存学期。');
      const duplicate=db.prepare('SELECT id FROM terms WHERE academic_year=? AND name=? AND id<>?').get(t.academicYear,t.name,old.id);if(duplicate)problem('学期名称重复。',409);
      if(t.academicYear!==old.academicYear||t.name!==old.name){if(db.prepare('SELECT id FROM public_courses WHERE term_id=? UNION SELECT id FROM timetables WHERE term_id=? LIMIT 1').get(old.id,old.id))problem('学期已有课程或个人课表，不能直接更改所属学年或名称；日期与日历配置仍可修改。');}
      db.prepare(`UPDATE terms SET academic_year=?,name=?,starts_on=?,ends_on=?,config_json=?,revision=revision+1,updated_at=${NOW} WHERE id=?`).run(t.academicYear,t.name,t.startsOn,t.endsOn,json(t.config),old.id);send(200,term(old.id));return;
    }
    const listMatch=path.match(/^\/api\/(?:admin\/)?timetable\/(cards|courses|templates)$/);
    if(listMatch&&req.method==='GET'){
      const t=term(url.searchParams.get('termId'));
      if(listMatch[1]==='templates'){
        const rows=db.prepare(`SELECT * FROM timetable_templates WHERE term_id=? ${adminPath?'':'AND published=1'} ORDER BY name`).all(t.id);
        const subscribers=db.prepare(`SELECT u.name FROM timetable_template_subscriptions sub
          JOIN timetables tt ON tt.id=sub.timetable_id JOIN users u ON u.id=tt.user_id
          WHERE sub.template_id=? AND tt.term_id=? ORDER BY u.name COLLATE NOCASE,u.student_id,u.id`);
        send(200,rows.map(r=>({id:r.id,termId:r.term_id,name:r.name,description:r.description,published:Boolean(r.published),revision:r.revision,courseIds:db.prepare('SELECT course_id FROM template_courses WHERE template_id=?').all(r.id).map(x=>x.course_id),subscriberNames:subscribers.all(r.id,t.id).map(u=>u.name),...(adminPath?{courses:templateCourses(r,t)}:{})})));return;
      }
      const query=trim(url.searchParams.get('q')).toLowerCase();
      const rows=db.prepare(`SELECT * FROM public_courses WHERE term_id=? ${!adminPath?'AND published=1':''} ${listMatch[1]==='cards'?'AND card_enabled=1':''} ORDER BY rowid DESC`).all(t.id);
      send(200,rows.map(r=>courseView(r,t)).filter(c=>`${c.course_name} ${c.teacher} ${c.course_code}`.toLowerCase().includes(query)));return;
    }
    if(['/api/timetable/preview','/api/admin/timetable/preview'].includes(path)&&req.method==='POST'){
      const body=await read(),t=term(body.termId);if(!['ai','manual'].includes(body.source))problem('请选择 AI 结果导入。');if(!adminPath)sourceCheck(user.id,t.id,body.source);const preview=prepare(body,t);send(200,adminPath?preview:checkImport(user.id,t,preview));return;
    }
    if(path==='/api/admin/timetable/template-preview'&&req.method==='POST'){send(200,templateImporter.preview(await read(),user.id));return;}
    if(path==='/api/admin/timetable/template-import'&&req.method==='POST'){send(201,templateImporter.save(await read(),user.id));return;}
    if(path==='/api/timetable/selection-preview'&&req.method==='POST'){
      const body=await read(),t=term(body.termId),tt=sourceCheck(user.id,t.id,body.source);let courses,selectionVersion,templateName;
      if(body.source==='template'){
        const template=db.prepare('SELECT * FROM timetable_templates WHERE id=? AND term_id=? AND published=1').get(body.templateId,t.id);if(!template)problem('请选择本学期已发布的模板。');
        courses=templateCourses(template,t);if(!courses.length||courses.some(c=>c.origin!=='manual'&&!c.published))problem('模板中包含已下架课程或没有可选课程，请重新选择模板。');
        selectionVersion=templateSelectionVersion(template,t,courses);
        templateName=template.name;
      }else if(body.source==='cards'){
        const existing=tt?db.prepare('SELECT course_id FROM timetable_entries WHERE timetable_id=?').all(tt.id).map(r=>r.course_id):[];
        courses=selectedCourses(body.courseIds,t,true,existing);
      }else problem('请选择模板或课程卡片。');
      // Imports always append; existing entries remain separate and are checked for occupancy.
      send(200,checkImport(user.id,t,{courses,warnings:[],conflicts:findConflicts(courses),...(selectionVersion?{selectionVersion,templateName}:{})}));return;
    }
    if(path==='/api/admin/timetable/courses'&&req.method==='POST'){
      const body=await read(),t=term(body.termId),p=prepare(body,t);requireReview(p,body);
      if(body.source==='manual'&&p.courses.length!==1)problem('手动添加每次只创建一张卡片模板。');
      let created=0,skipped=0,cardsCreated=0;
      transaction(()=>{for(const c of p.courses){const existing=matchingMaster(c,t);
        if(existing){if(body.source==='manual')problem('该课程已经添加过了：课程名称、教师和上课时间一致，请编辑已有卡片模板，避免重复添加。',409);skipped++;if(body.generateCards!==false&&!existing.card_enabled){db.prepare('UPDATE public_courses SET card_enabled=1 WHERE id=?').run(existing.id);cardsCreated++;}continue;}
        db.prepare('INSERT INTO public_courses (id,term_id,class_code,payload_json,card_enabled,published,origin) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),t.id,null,json(normalizeCourse(c,t)),body.generateCards===false?0:1,body.published===false?0:1,body.source==='manual'?'manual':'template');created++;if(body.generateCards!==false)cardsCreated++;
      }onCoursesChanged(t.id);});send(201,{created,skipped,cardsCreated});return;
    }
    const courseEdit=path.match(/^\/api\/admin\/timetable\/courses\/([\w-]+)$/);
    if(courseEdit&&req.method==='PUT'){
      const body=await read(),old=master(courseEdit[1]);if(!old)problem('课程不存在。',404);if(Number(body.revision)!==old.revision)problem('课程已被修改，请刷新后再编辑。',409);
      const t=term(old.term_id),c=normalizeCourse(body.course,t);const check={courses:[{...c,...expandCourse(c,t)}],warnings:[],conflicts:[]};requireReview(check,body);
      if(matchingMaster(c,term(old.term_id),false,old.id))problem('已有课程名称、教师及上课时间完全一致的课程，请编辑原课程。',409);
      transaction(()=>{preserveLegacyEditsForCourse(old.id);db.prepare(`UPDATE public_courses SET class_code=?,payload_json=?,card_enabled=?,published=?,revision=revision+1,updated_at=${NOW} WHERE id=?`).run(null,json(c),body.cardEnabled===false?0:1,body.published===false?0:1,old.id);onCoursesChanged(t.id);});send(200,courseView(master(old.id),t));return;
    }
    if(path==='/api/admin/timetable/templates'&&req.method==='POST'){
      const body=await read(),t=term(body.termId);const name=trim(body.name,80);if(!name)problem('请输入模板名称。');if(db.prepare('SELECT id FROM timetable_templates WHERE term_id=? AND name=? COLLATE NOCASE').get(t.id,name))problem('本学期已有同名模板，请使用不同名称。',409);const courses=selectedCourses(body.courseIds,t);const id=randomUUID();transaction(()=>{templateImporter.rejectDuplicate(t,courses,user.id);db.prepare('INSERT INTO timetable_templates (id,term_id,name,description,published,created_by) VALUES (?,?,?,?,?,?)').run(id,t.id,name,trim(body.description,500),body.published===false?0:1,user.id);for(const c of courses)db.prepare('INSERT INTO template_courses(template_id,course_id,course_snapshot_json) VALUES (?,?,?)').run(id,c.id,c.origin==='manual'?json(normalizeCourse(c,t)):null);});send(201,{id});return;
    }
    const templateEdit=path.match(/^\/api\/admin\/timetable\/templates\/([\w-]+)$/);
    if(templateEdit&&req.method==='DELETE'){
      const body=await read(),id=templateEdit[1];
      transaction(()=>{
        const old=db.prepare('SELECT * FROM timetable_templates WHERE id=?').get(id);
        if(!old)problem('模板不存在或已被删除，请刷新列表。',404);
        if(old.revision!==Number(body.revision))problem('模板已更新，请刷新后重新确认删除。',409);
        if(body.confirm!==true)problem('请先确认删除模板。');
        const affected=db.prepare(`SELECT tt.* FROM timetables tt WHERE tt.template_id=? OR EXISTS(
          SELECT 1 FROM timetable_template_subscriptions sub WHERE sub.timetable_id=tt.id AND sub.template_id=?
        ) OR EXISTS(SELECT 1 FROM timetable_entries e JOIN timetable_entry_templates et ON et.entry_id=e.id WHERE e.timetable_id=tt.id AND et.template_id=?)`).all(id,id,id);
        for(const tt of affected)syncTemplateMembers(tt,old);
        // Deleting a reusable template must not remove students' courses.
        // Convert its selections into direct card selections before unlinking.
        db.prepare(`UPDATE timetable_entries SET direct_source=COALESCE(direct_source,'cards') WHERE id IN(
          SELECT entry_id FROM timetable_entry_templates WHERE template_id=?
        )`).run(id);
        for(const tt of affected)db.prepare(`UPDATE timetables SET
          template_revision=CASE WHEN template_id=? THEN NULL ELSE template_revision END,
          template_id=CASE WHEN template_id=? THEN NULL ELSE template_id END,
          revision=revision+1 WHERE id=?`).run(id,id,tt.id);
        db.prepare('DELETE FROM timetable_templates WHERE id=?').run(id);
      });
      send(200,{ok:true});return;
    }
    if(templateEdit&&req.method==='PUT'){
      const body=await read(),old=db.prepare('SELECT * FROM timetable_templates WHERE id=?').get(templateEdit[1]);if(!old)problem('模板不存在。',404);if(old.revision!==Number(body.revision))problem('模板已更新，请刷新后编辑。',409);
      const name=trim(body.name,80);if(!name)problem('请输入模板名称。');if(db.prepare('SELECT id FROM timetable_templates WHERE term_id=? AND name=? COLLATE NOCASE AND id<>?').get(old.term_id,name,old.id))problem('本学期已有同名模板，请使用不同名称。',409);
      const previousMembers=new Map(templateCourses(old,term(old.term_id)).map(c=>[c.id,c]));
      const courses=selectedCourses(body.courseIds,term(old.term_id),false,[...previousMembers.values()].filter(c=>c.origin==='manual').map(c=>c.id)).map(c=>c.origin==='manual'&&previousMembers.has(c.id)?previousMembers.get(c.id):c);
      const changes=body.courseChanges||[];
      if(!Array.isArray(changes)||changes.length>200)problem('课程修改格式不正确。');
      transaction(()=>{
        for(const tt of db.prepare('SELECT tt.* FROM timetables tt JOIN timetable_template_subscriptions sub ON sub.timetable_id=tt.id WHERE sub.template_id=?').all(old.id))preserveLegacyChoices(tt,old);
        const changed=new Map(),manualChanged=new Map(),seen=new Set(),t=term(old.term_id),selectedIds=new Set(courses.map(c=>c.id));
        for(const change of changes){
          if(!change||!selectedIds.has(change.id)||seen.has(change.id))problem('只能修改本次模板中已选的课程。');seen.add(change.id);
          const row=master(change.id);if(!row||row.term_id!==old.term_id)problem('课程不属于此学期。');
          if(row.revision!==Number(change.revision))problem('模板中的课程已更新，请重新打开模板后编辑。',409);
          const course=normalizeCourse(change.course,t);requireReview({courses:[{...course,...expandCourse(course,t)}],warnings:[],conflicts:[]},body);
          (row.origin==='manual'?manualChanged:changed).set(row.id,course);
        }
        const identities=new Set();
        for(const row of db.prepare('SELECT * FROM public_courses WHERE term_id=?').all(old.term_id)){
          const key=courseIdentity(changed.get(row.id)||parse(row.payload_json),t);
          if(key&&changed.has(row.id)){
            const duplicate=db.prepare('SELECT * FROM public_courses WHERE term_id=? AND id<>?').all(old.term_id,row.id).some(other=>courseIdentity(changed.get(other.id)||parse(other.payload_json),t)===key);
            if(duplicate||identities.has(key))problem('已有课程名称、教师和上课时间完全一致的卡片，请核对后再保存。',409);
          }
          if(key)identities.add(key);
        }
        for(const id of changed.keys())preserveLegacyEditsForCourse(id);
        for(const [id,course] of changed)db.prepare(`UPDATE public_courses SET payload_json=?,revision=revision+1,updated_at=${NOW} WHERE id=?`).run(json(course),id);
        db.prepare(`UPDATE timetable_templates SET name=?,description=?,published=?,revision=revision+1,updated_at=${NOW} WHERE id=?`).run(name,body.description===undefined?old.description:trim(body.description,500),body.published===false?0:1,old.id);db.prepare('DELETE FROM template_courses WHERE template_id=?').run(old.id);for(const c of courses)db.prepare('INSERT INTO template_courses(template_id,course_id,course_snapshot_json) VALUES (?,?,?)').run(old.id,c.id,c.origin==='manual'?json(manualChanged.get(c.id)||normalizeCourse(c,t)):null);
        const updated=db.prepare('SELECT * FROM timetable_templates WHERE id=?').get(old.id);
        for(const tt of db.prepare("SELECT tt.* FROM timetables tt JOIN timetable_template_subscriptions sub ON sub.timetable_id=tt.id WHERE sub.template_id=? AND tt.term_id=?").all(old.id,old.term_id))syncTemplateMembers(tt,updated);
        onCoursesChanged(old.term_id);
      });send(200,{ok:true});return;
    }
    const personal=path.match(/^\/api\/timetable\/([\w-]+)$/);
    if(personal&&req.method==='GET'){send(200,get(user.id,personal[1]));return;}
    if(personal&&req.method==='DELETE'){
      const body=await read(),tt=table(user.id,personal[1]);if(!tt)problem('本学期尚无个人课表。',404);checkRevision(tt,body.revision);if(body.confirm!==true)problem('请确认删除本学期个人课表。');db.prepare('DELETE FROM timetables WHERE id=? AND user_id=?').run(tt.id,user.id);send(200,{ok:true});return;
    }
    if(personal&&req.method==='POST'){
      const body=await read(),t=term(personal[1]);let tt=sourceCheck(user.id,t.id,body.source);checkRevision(tt,body.revision);
      if(body.source==='ai'){
        const p=prepare(body,t);requireImport(user.id,t,p);requireReview(p,body);let added=0;
        transaction(()=>{tt=tt||newTable(user.id,t,body.source);
          for(const raw of p.courses){const c=normalizeCourse(raw,t),pub=matchingMaster(c,t,true);insertEntry(tt,pub?.id||null,c,body.source);added++;}bump(tt);onCoursesChanged(t.id);
        });send(200,{...get(user.id,t.id),added,skipped:0});return;
      }
      let chosen,template=null;
      if(body.source==='template'){
        template=db.prepare('SELECT * FROM timetable_templates WHERE id=? AND term_id=? AND published=1').get(body.templateId,t.id);if(!template)problem('请选择本学期已发布模板。');
        chosen=templateCourses(template,t);if(!chosen.length||chosen.some(c=>c.origin!=='manual'&&!c.published))problem('模板中包含已下架课程或没有可选课程，请重新选择模板。');
        if(body.selectionVersion!==undefined&&body.selectionVersion!==templateSelectionVersion(template,t,chosen))problem('模板或课程安排已更新，请重新加载后再使用。',409);
      }else chosen=selectedCourses(body.courseIds,t,true);
      const p={courses:chosen,warnings:[],conflicts:findConflicts(chosen)};requireImport(user.id,t,p);requireReview(p,body);
      transaction(()=>{
        tt=tt||newTable(user.id,t,body.source,template);
        if(template)db.prepare('INSERT OR REPLACE INTO timetable_template_subscriptions VALUES (?,?,?)').run(tt.id,template.id,template.revision);
        for(const c of chosen){if(template)db.prepare('DELETE FROM timetable_template_course_choices WHERE timetable_id=? AND template_id=? AND course_id=?').run(tt.id,template.id,c.id);const entryId=insertEntry(tt,c.id,null,template?null:'cards',template&&c.origin==='manual'?json(normalizeCourse(c,t)):null);if(template)db.prepare('INSERT INTO timetable_entry_templates VALUES (?,?)').run(entryId,template.id);}
        bump(tt);
      });send(200,{...get(user.id,t.id),added:chosen.length,skipped:0});return;
    }
    const entryPath=path.match(/^\/api\/timetable\/([\w-]+)\/entries\/([\w-]+)(\/reset)?$/);
    if(entryPath){
      const body=await read(),t=term(entryPath[1]),tt=table(user.id,t.id);if(!tt)problem('个人课表不存在。',404);
      const e=db.prepare('SELECT * FROM timetable_entries WHERE id=? AND timetable_id=?').get(entryPath[2],tt.id);if(!e)problem('课程不属于当前个人课表。',404);
      checkRevision(tt,body.revision);
      if(req.method==='DELETE'&&!entryPath[3]){transaction(()=>{for(const {template_id} of templateLinks(e))rememberChoice(tt,template_id,e.course_id,'removed');db.prepare('DELETE FROM timetable_entries WHERE id=?').run(e.id);bump(tt);});send(200,get(user.id,t.id));return;}
      if(req.method==='POST'&&entryPath[3]){
        let personal=parse(e.private_json);if(e.course_id&&personal){for(const key of ['weekly_rules','special_dates','explicit_sessions','room'])delete personal[key];}
        transaction(()=>{
          const linked=templateLinks(e),defaults=db.prepare('SELECT tc.course_snapshot_json FROM timetable_entry_templates et JOIN template_courses tc ON tc.template_id=et.template_id AND tc.course_id=? WHERE et.entry_id=? ORDER BY et.template_id=? DESC,et.template_id LIMIT 1').get(e.course_id,e.id,tt.template_id);
          for(const {template_id} of linked)db.prepare("DELETE FROM timetable_template_course_choices WHERE timetable_id=? AND template_id=? AND course_id=? AND action='edited'").run(tt.id,template_id,e.course_id);
          db.prepare('DELETE FROM timetable_entry_templates WHERE entry_id=? AND template_id NOT IN (SELECT template_id FROM template_courses WHERE course_id=?)').run(e.id,e.course_id);
          db.prepare('UPDATE timetable_entries SET override_json=NULL,private_json=?,base_snapshot_json=?,base_revision=?,direct_source=CASE WHEN ? THEN direct_source ELSE COALESCE(direct_source,\'cards\') END WHERE id=?').run(personal?json(personal):null,defaults?.course_snapshot_json||null,e.course_id?master(e.course_id)?.revision||0:0,defaults?1:0,e.id);bump(tt);
        });send(200,get(user.id,t.id));return;
      }
      if(req.method==='PATCH'&&!entryPath[3]){
        if(e.course_id&&Number(body.publicRevision)!==(e.base_snapshot_json?e.base_revision:master(e.course_id)?.revision))problem('公共课程刚刚更新，请刷新课表并核对新安排后再保存个人修改。',409);
        const current=entryView(e,t),normalized=normalizeCourse({...current,weekly_rules:[],special_dates:[],explicit_sessions:body.sessions,room:body.room},t);
        normalized.explicit_sessions=numberLessons(normalized.explicit_sessions);
        const defaults=entryView({...e,override_json:null},t).sessions;
        const changedTimes=normalized.explicit_sessions.length!==defaults.length||normalized.explicit_sessions.some((s,i)=>{const d=defaults[i];return !d||s.date!==d.date||s.start_time!==d.start_time||s.end_time!==d.end_time||(s.kind==='practice')!==(d.kind==='practice');});
        const rooms={};normalized.explicit_sessions.forEach((s,i)=>{if(s.kind!=='practice'&&(s.room||null)!==(defaults[i]?.room||null))rooms[String(i)]=s.room||null;});
        const override={time_override:changedTimes?normalized.explicit_sessions.map(s=>({...s,room:null})):null,room_overrides:rooms,base_session_count:defaults.length};
        if(!normalized.explicit_sessions.length&&body.markPending!==true)problem('请填写至少一次安排，或明确设为待安排。');
        transaction(()=>{preserveTemplateEdit(e,t);db.prepare('UPDATE timetable_entries SET override_json=? WHERE id=?').run(json(override),e.id);bump(tt);});send(200,get(user.id,t.id));return;
      }
    }
    problem('课表接口不存在。',404);
  }
  return {handle,get,prepare,term,entryView};
}
