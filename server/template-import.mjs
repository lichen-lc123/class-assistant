import {createHash,randomUUID} from 'node:crypto';
import {normalizeCourse,expandCourse,findConflicts,problem,trim} from './schedule.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compact=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
const teacher=s=>String(s||'').split(/[、,，/；;\s]+/).filter(Boolean).map(compact).sort().join('|');
export function sameTeachingClass(a,b){return compact(a.course_name)===compact(b.course_name)&&(!a.teacher||!b.teacher||teacher(a.teacher)===teacher(b.teacher));}
function schedule(course,t){return expandCourse(course,t).sessions.map(s=>({date:s.date,start:s.start_time,end:s.end_time,room:compact(s.room),kind:s.kind||'lecture'})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
function scheduleSignature(course,t){const sessions=schedule(course,t);return hash(sessions.length?sessions:{weekly:course.weekly_rules,special:course.special_dates,explicit:course.explicit_sessions,room:course.room});}
function templateContentSignature(courses,t){
  return hash(courses.map(raw=>{
    const c=normalizeCourse(raw,t);
    return hash({name:compact(c.course_name),code:compact(c.course_code),classCode:compact(c.teaching_class_code),teacher:teacher(c.teacher),credits:c.credits??null,college:compact(c.college),category:compact(c.course_category),required:compact(c.required_or_elective),schedule:scheduleSignature(c,t)});
  }).sort());
}
// Missing class IDs can only be deduplicated when the teacher and the complete
// dated schedule are known. Equal names or pending schedules are insufficient.
function fallbackSignature(course,t){
  if(!course.teacher)return null;const result=expandCourse(course,t);
  if(!result.sessions.length||result.sessions.some(s=>s.kind!=='practice'&&!s.room)||result.warnings.some(w=>!w.includes('缺少上课班编号')))return null;
  return hash({name:compact(course.course_name),code:compact(course.course_code),teacher:teacher(course.teacher),sessions:schedule(course,t)});
}
export function templateImportService(db,{term,prepare,requireReview}){
  const catalogRows=termId=>db.prepare('SELECT * FROM public_courses WHERE term_id=? ORDER BY id').all(termId);
  const version=rows=>hash(rows.map(r=>[r.id,r.revision,r.card_enabled,r.published,r.payload_json]));
  function rejectDuplicate(t,courses,userId){
    const signature=templateContentSignature(courses,t);
    const candidates=db.prepare('SELECT id,name FROM timetable_templates WHERE term_id=? AND (created_by IS NULL OR created_by<>?) ORDER BY name,id').all(t.id,userId);
    for(const candidate of candidates){
      const existing=db.prepare('SELECT c.payload_json FROM template_courses tc JOIN public_courses c ON c.id=tc.course_id WHERE tc.template_id=? ORDER BY c.id').all(candidate.id);
      if(existing.length===courses.length&&templateContentSignature(existing.map(row=>JSON.parse(row.payload_json)),t)===signature)problem(`导入失败：课程名称、老师、上课班、时间和教室等内容与已有模板“${candidate.name}”完全一致，请直接使用已有模板。`,409);
    }
  }
  function plan(body,userId){
    if(!['ai','excel'].includes(body.source))problem('模板仅支持AI内容导入或Excel导入。');
    const t=term(body.termId),p=prepare({...body,strictTemplate:true},t),rows=catalogRows(t.id),warnings=[...p.warnings],items=[],seen=new Map();
    const stored=rows.map(row=>({row,course:normalizeCourse(JSON.parse(row.payload_json),t)}));
    for(const raw of p.courses){
      const course=normalizeCourse(raw,t),signature=course.teaching_class_code?null:fallbackSignature(course,t);
      const batchKey=course.teaching_class_code?'class:'+course.teaching_class_code:signature?'signature:'+signature:null;
      if(batchKey&&seen.has(batchKey)){warnings.push(`${course.course_name} 在本份课表中重复，模板和卡片各保留一次。`);continue;}
      const matches=course.teaching_class_code?stored.filter(x=>x.row.class_code===course.teaching_class_code):signature?stored.filter(x=>!x.row.class_code&&fallbackSignature(x.course,t)===signature):[];
      if(matches.length>1)problem(`${course.course_name} 有多张相同的历史卡片，请先在课程卡片中核对并补齐上课班编号。`,409);
      const existing=matches[0]||null;
      if(existing&&!sameTeachingClass(course,existing.course))problem(`上课班 ${course.teaching_class_code} 已有不同的课程名称或老师，请核对班号后重新预览。`,409);
      if(existing&&scheduleSignature(course,t)!==scheduleSignature(existing.course,t))warnings.push(`${course.course_name}（${course.teaching_class_code||'无班号'}）与已有卡片安排不同，本模板将沿用已有卡片；如需调整，请到模板页的课程卡片中编辑。`);
      if(existing&&!existing.row.published)warnings.push(`${course.course_name} 的已有卡片已下架，本次确认导入后将恢复发布。`);
      if(!course.teaching_class_code&&!signature)warnings.push(`${course.course_name} 缺少班号且时间或老师未完整确定，不能仅凭名称去重，先保留独立卡片，请核对补齐信息。`);
      const actual=existing?existing.course:course,item={course:actual,existing:existing?.row||null};items.push(item);if(batchKey)seen.set(batchKey,item);
    }
    const courses=items.map((item,i)=>({...item.course,id:item.existing?.id||'preview-'+i,matchedCourseId:item.existing?.id||null,importAction:item.existing?'reuse':'new',...expandCourse(item.course,t)}));
    rejectDuplicate(t,courses,userId);
    const preview={courses,warnings:[...new Set(warnings)],conflicts:findConflicts(courses),unparsedItems:p.unparsedItems,importWarnings:p.importWarnings,catalogVersion:version(rows),stats:{newCourses:items.filter(i=>!i.existing).length,reusedCourses:items.filter(i=>i.existing).length}};
    return{t,items,preview};
  }
  function save(body,userId){
    if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>80)problem('请输入1—80字的模板名称。');
    if(body.description!=null&&(typeof body.description!=='string'||body.description.length>500))problem('模板说明不能超过500字。');
    if(body.acceptWarnings!==true)problem('请先核对模板课程与去重结果，再确认保存。');
    const {t,items,preview}=plan(body,userId);requireReview(preview,body);
    if(body.catalogVersion!==preview.catalogVersion)problem('课程卡片已发生变化，请重新预览后保存模板。',409);
    const name=body.name.trim(),id=randomUUID();let created=0,reused=0,cardsCreated=0;
    db.exec('BEGIN IMMEDIATE');
    try{
      if(version(catalogRows(t.id))!==body.catalogVersion)problem('课程卡片已更新，请重新预览。',409);
      rejectDuplicate(t,items.map(item=>item.course),userId);
      if(db.prepare('SELECT id FROM timetable_templates WHERE term_id=? AND name=? COLLATE NOCASE').get(t.id,name))problem('本学期已有同名模板，请使用不同名称或编辑原模板。',409);
      db.prepare('INSERT INTO timetable_templates(id,term_id,name,description,published,created_by) VALUES(?,?,?,?,?,?)').run(id,t.id,name,trim(body.description,500),body.published===false?0:1,userId);
      for(const item of items){let courseId=item.existing?.id;
        if(item.existing){reused++;if(!item.existing.card_enabled||!item.existing.published){db.prepare("UPDATE public_courses SET card_enabled=1,published=1,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(courseId);if(!item.existing.card_enabled)cardsCreated++;}}
        else{courseId=randomUUID();db.prepare('INSERT INTO public_courses(id,term_id,class_code,payload_json,card_enabled,published) VALUES(?,?,?,?,1,1)').run(courseId,t.id,item.course.teaching_class_code,JSON.stringify(item.course));created++;cardsCreated++;}
        db.prepare('INSERT INTO template_courses(template_id,course_id) VALUES(?,?)').run(id,courseId);
      }
      db.exec('COMMIT');return{id,name,courseCount:items.length,created,reused,cardsCreated};
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  return{preview:(body,userId)=>plan(body,userId).preview,save,rejectDuplicate};
}
