import {courseIdentity} from '../../course-identity.mjs';
// Older fixture names are retained only to find the new course reference.
export function courseTarget(db,fixtureCode){
  const publicRow=db.prepare("SELECT id FROM public_courses WHERE json_extract(payload_json,'$.teaching_class_code')=? ORDER BY id LIMIT 1").get(fixtureCode);
  if(publicRow)return 'course:'+publicRow.id;
  const row=db.prepare("SELECT e.private_json,t.* FROM timetable_entries e JOIN timetables tt ON tt.id=e.timetable_id JOIN terms t ON t.id=tt.term_id WHERE json_extract(e.private_json,'$.teaching_class_code')=? LIMIT 1").get(fixtureCode);
  if(row){const key=courseIdentity(JSON.parse(row.private_json),{id:row.id,academicYear:row.academic_year,name:row.name,config:JSON.parse(row.config_json)});if(key)return 'identity:'+key;}
  throw new Error('Fixture course is missing its name, teacher or schedule: '+fixtureCode);
}
