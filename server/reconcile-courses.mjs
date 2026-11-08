import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeCourse,expandCourse} from './schedule.mjs';
import {courseIdentity} from './course-identity.mjs';
import {hasConfirmedCompleteDateList} from './confirmed-schedule.mjs';
import {courseTeachingWeek} from '../shared/course-week.mjs';
import {timetableService} from './timetable.mjs';

const parse=value=>value?JSON.parse(value):null;
const stable=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable(value[k]))])):Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):value);
function combine(a,b){
  if(a==null)return b;if(b==null)return a;
  if(stable(a)===stable(b))return a;
  if(typeof a!=='object'||typeof b!=='object'||Array.isArray(a)||Array.isArray(b))throw new Error('personal-conflict');
  const result={...a};
  for(const [key,value] of Object.entries(b)){
    if(!Object.hasOwn(result,key))result[key]=value;
    else if(stable(result[key])!==stable(value)){
      // Null inside a room map is a deliberate personal change.
      if(result[key]==null||value==null)throw new Error('personal-conflict');
      result[key]=combine(result[key],value);
    }
  }
  return result;
}
const protectedTables=['users','sessions','homework_completions','homework_preferences','homework_reads','homework_assets','homework_attachments'];
function protection(db){return Object.fromEntries(protectedTables.map(table=>{
  const hash=createHash('sha256');
  for(const row of db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).iterate()){
    if(row.bytes)row.bytes=createHash('sha256').update(row.bytes).digest('hex');
    hash.update(stable(row));
  }
  return[table,hash.digest('hex')];
}));}
const roomSignature=(course,term)=>stable((course.sessions||expandCourse(normalizeCourse(course,term),term).sessions).map(s=>[s.date,s.start_time,s.end_time,s.room,s.kind]));

// Dry runs execute the exact same transaction and roll it back. No student names,
// password hashes, assignment contents or attachment bytes are included in reports.
export function reconcileCourses(db,{apply=false}={}){
  const report={mode:apply?'apply':'dry-run',termsUpdated:0,payloadsUpdated:0,confirmedSchedulesFixed:0,cardsMerged:0,entriesMerged:0,targetsUpdated:0,skippedConflicts:0,skippedInvalid:0};
  const service=timetableService(db),before=protection(db),changedTables=new Set(),changedTemplates=new Set();
  db.exec('BEGIN IMMEDIATE');
  try{
    const terms=new Map();
    for(const row of db.prepare('SELECT * FROM terms').all()){
      const term=service.term(row.id);terms.set(row.id,term);
      if(stable(parse(row.config_json))!==stable(term.config)){
        db.prepare('UPDATE terms SET config_json=?,revision=revision+1 WHERE id=?').run(JSON.stringify(term.config),row.id);report.termsUpdated++;
      }
    }
    function revise(payload,term){
      const original=parse(payload);if(!original?.course_name)return payload;
      try{
        const course=normalizeCourse(original,term),complete=hasConfirmedCompleteDateList(course);
        if(complete){
          const expanded=expandCourse(course,term);
          course.extra_fields={...course.extra_fields,'原始周次规则':course.weekly_rules,'原始日期记录':course.special_dates,'已确认总课次':8,'完整清单规则版本':'2026-11-08'};
          course.explicit_sessions=expanded.sessions.map(({date,start_time,end_time,room,kind,lesson_number,week,weekday})=>({date,start_time,end_time,room,kind,lesson_number,week,weekday}));
          course.weekly_rules=[];course.special_dates=[];report.confirmedSchedulesFixed++;
        }
        course.explicit_sessions=course.explicit_sessions.map(s=>({...s,...(courseTeachingWeek(s.date,course,term)!=null?{week:courseTeachingWeek(s.date,course,term)}:{}),weekday:new Date(s.date+'T00:00:00Z').getUTCDay()||7}));
        const next={...original,...course};
        if(stable(original)===stable(next))return payload;
        report.payloadsUpdated++;return JSON.stringify(next);
      }catch(error){report.skippedInvalid++;return payload;}
    }
    for(const row of db.prepare('SELECT * FROM public_courses ORDER BY id').all()){
      const next=revise(row.payload_json,terms.get(row.term_id));
      if(next!==row.payload_json)db.prepare('UPDATE public_courses SET payload_json=?,revision=revision+1 WHERE id=?').run(next,row.id);
    }
    for(const row of db.prepare('SELECT tc.*,t.term_id FROM template_courses tc JOIN timetable_templates t ON t.id=tc.template_id WHERE course_snapshot_json IS NOT NULL').all()){
      const next=revise(row.course_snapshot_json,terms.get(row.term_id));
      if(next!==row.course_snapshot_json){db.prepare('UPDATE template_courses SET course_snapshot_json=? WHERE template_id=? AND course_id=?').run(next,row.template_id,row.course_id);changedTemplates.add(row.template_id);}
    }
    for(const row of db.prepare('SELECT e.*,t.term_id FROM timetable_entries e JOIN timetables t ON t.id=e.timetable_id').all()){
      // Override JSON is intentionally never normalized or replaced.
      const personal=row.private_json?revise(row.private_json,terms.get(row.term_id)):null;
      const snapshot=row.base_snapshot_json?revise(row.base_snapshot_json,terms.get(row.term_id)):null;
      if(personal!==row.private_json||snapshot!==row.base_snapshot_json){db.prepare('UPDATE timetable_entries SET private_json=?,base_snapshot_json=? WHERE id=?').run(personal,snapshot,row.id);changedTables.add(row.timetable_id);}
    }
    const groups=new Map();
    for(const row of db.prepare("SELECT * FROM public_courses ORDER BY CASE origin WHEN 'manual' THEN 0 ELSE 1 END,id").all()){
      let key;try{key=courseIdentity(parse(row.payload_json),terms.get(row.term_id));}catch{report.skippedInvalid++;continue;}
      if(!key)continue;const rows=groups.get(key)||[];rows.push(row);groups.set(key,rows);
    }
    for(const rows of groups.values()){
      const keep=rows[0],term=terms.get(keep.term_id);
      for(const drop of rows.slice(1)){
        // Different room/practice arrangements remain separate for review.
        if(roomSignature(parse(keep.payload_json),term)!==roomSignature(parse(drop.payload_json),term)){report.skippedConflicts++;continue;}
        const links=db.prepare('SELECT * FROM template_courses WHERE course_id=?').all(drop.id);
        const incompatible=links.some(link=>{
          const existing=db.prepare('SELECT * FROM template_courses WHERE template_id=? AND course_id=?').get(link.template_id,keep.id);
          return existing&&stable(parse(existing.course_snapshot_json)||parse(keep.payload_json))!==stable(parse(link.course_snapshot_json)||parse(drop.payload_json));
        });
        if(incompatible){report.skippedConflicts++;continue;}
        for(const link of links){
          const snapshot=link.course_snapshot_json||(keep.origin==='manual'?drop.payload_json:null);
          db.prepare('INSERT OR IGNORE INTO template_courses(template_id,course_id,course_snapshot_json) VALUES(?,?,?)').run(link.template_id,keep.id,snapshot);
          changedTemplates.add(link.template_id);
        }
        // Keep the exact old base for followers if catalog metadata differs.
        for(const entry of db.prepare('SELECT * FROM timetable_entries WHERE course_id=?').all(drop.id)){
          const snapshot=entry.base_snapshot_json||(stable(parse(drop.payload_json))!==stable(parse(keep.payload_json))?drop.payload_json:null);
          db.prepare('UPDATE timetable_entries SET course_id=?,base_snapshot_json=?,base_revision=? WHERE id=?').run(keep.id,snapshot,keep.revision,entry.id);changedTables.add(entry.timetable_id);
        }
        db.prepare('UPDATE homework_targets SET course_id=? WHERE course_id=?').run(keep.id,drop.id);
        db.prepare('DELETE FROM template_courses WHERE course_id=?').run(drop.id);
        db.prepare('UPDATE public_courses SET card_enabled=MAX(card_enabled,?),published=MAX(published,?) WHERE id=?').run(drop.card_enabled,drop.published,keep.id);
        db.prepare('DELETE FROM public_courses WHERE id=?').run(drop.id);report.cardsMerged++;
      }
    }
    for(const tt of db.prepare('SELECT * FROM timetables').all()){
      const term=terms.get(tt.term_id),seen=new Map();
      const entries=db.prepare('SELECT * FROM timetable_entries WHERE timetable_id=? ORDER BY course_id IS NULL,created_at,id').all(tt.id);
      for(const entry of entries){
        let key,view;try{view=service.entryView(entry,term);key=courseIdentity(view,term);}catch{report.skippedInvalid++;continue;}
        if(!key)continue;const keeper=seen.get(key);
        if(!keeper){seen.set(key,entry);continue;}
        let personal,override;
        try{
          if(roomSignature(service.entryView(keeper,term),term)!==roomSignature(view,term))throw new Error('room-conflict');
          personal=combine(parse(keeper.private_json),parse(entry.private_json));override=combine(parse(keeper.override_json),parse(entry.override_json));
          const a=parse(keeper.base_snapshot_json),b=parse(entry.base_snapshot_json);
          if(a&&b&&stable(a)!==stable(b))throw new Error('snapshot-conflict');
          // Different public references can carry different future updates.
          if(keeper.course_id&&entry.course_id&&keeper.course_id!==entry.course_id)throw new Error('reference-conflict');
        }catch{report.skippedConflicts++;continue;}
        const snapshot=keeper.base_snapshot_json||entry.base_snapshot_json;
        db.prepare('UPDATE timetable_entries SET private_json=?,override_json=?,direct_source=COALESCE(direct_source,?),base_snapshot_json=? WHERE id=?').run(personal?JSON.stringify(personal):null,override?JSON.stringify(override):null,entry.direct_source,snapshot,keeper.id);
        db.prepare('INSERT OR IGNORE INTO timetable_entry_templates SELECT ?,template_id FROM timetable_entry_templates WHERE entry_id=?').run(keeper.id,entry.id);
        // Personal homework references entry IDs; preserve ownership and all state.
        for(const work of db.prepare('SELECT id,payload_json FROM homework_records WHERE owner_id=? AND term_id=?').all(tt.user_id,tt.term_id)){
          const payload=parse(work.payload_json);if(payload.course_entry_id!==entry.id)continue;
          payload.course_entry_id=keeper.id;db.prepare('UPDATE homework_records SET payload_json=? WHERE id=?').run(JSON.stringify(payload),work.id);
        }
        db.prepare('DELETE FROM timetable_entries WHERE id=?').run(entry.id);report.entriesMerged++;changedTables.add(tt.id);
        Object.assign(keeper,{private_json:personal?JSON.stringify(personal):null,override_json:override?JSON.stringify(override):null,base_snapshot_json:snapshot,direct_source:keeper.direct_source||entry.direct_source});
      }
    }
    for(const target of db.prepare('SELECT ht.*,c.payload_json,c.term_id FROM homework_targets ht JOIN public_courses c ON c.id=ht.course_id').all()){
      const identity=courseIdentity(parse(target.payload_json),terms.get(target.term_id));
      if(identity!==target.identity_key){db.prepare('UPDATE homework_targets SET identity_key=? WHERE record_id=? AND target_key=?').run(identity,target.record_id,target.target_key);report.targetsUpdated++;}
    }
    for(const id of changedTemplates){db.prepare('UPDATE timetable_templates SET revision=revision+1 WHERE id=?').run(id);}
    for(const id of changedTables)db.prepare('UPDATE timetables SET revision=revision+1 WHERE id=?').run(id);
    assert.deepEqual(protection(db),before,'Protected account/homework state changed');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[],'Foreign key validation failed');
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
    db.exec(apply?'COMMIT':'ROLLBACK');return report;
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}
