import {courseIdentity} from './course-identity.mjs';

export function initHomeworkSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS homework_records(
      id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id), source_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('assignment','reference')), title TEXT NOT NULL,
      payload_json TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(term_id,source_key)
    );
    CREATE TABLE IF NOT EXISTS homework_targets(
      record_id TEXT NOT NULL REFERENCES homework_records(id) ON DELETE CASCADE,
      target_key TEXT NOT NULL, course_id TEXT REFERENCES public_courses(id), class_code TEXT,
      PRIMARY KEY(record_id,target_key)
    );
    CREATE TABLE IF NOT EXISTS homework_assets(
      id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS homework_attachments(
      record_id TEXT NOT NULL REFERENCES homework_records(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES homework_assets(id), field TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(record_id,asset_id,field)
    );
    CREATE TABLE IF NOT EXISTS homework_completions(
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      record_id TEXT NOT NULL REFERENCES homework_records(id) ON DELETE CASCADE,
      completed_revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(user_id,record_id)
    );
    CREATE INDEX IF NOT EXISTS homework_term ON homework_records(term_id);
    CREATE INDEX IF NOT EXISTS homework_class ON homework_targets(class_code);
    CREATE TABLE IF NOT EXISTS homework_preferences(
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      record_id TEXT NOT NULL REFERENCES homework_records(id) ON DELETE CASCADE,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('high','normal','low')),
      planned_date TEXT, planned_time TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(user_id,record_id)
    );
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS homework_reads(
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    record_id TEXT NOT NULL REFERENCES homework_records(id) ON DELETE CASCADE,
    seen_revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,record_id)
  )`);
  if(!db.prepare('PRAGMA table_info(homework_records)').all().some(c=>c.name==='update_revision'))db.exec('ALTER TABLE homework_records ADD COLUMN update_revision INTEGER NOT NULL DEFAULT 0');
  if(!db.prepare('PRAGMA table_info(homework_records)').all().some(c=>c.name==='owner_id')){
    db.exec('ALTER TABLE homework_records ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
  }
  db.exec('CREATE INDEX IF NOT EXISTS homework_owner ON homework_records(owner_id)');
  if(!db.prepare('PRAGMA table_info(homework_targets)').all().some(c=>c.name==='identity_key')){
    db.exec('BEGIN IMMEDIATE');
    try{
      db.exec('ALTER TABLE homework_targets ADD COLUMN identity_key TEXT');
      const rows=db.prepare('SELECT ht.*,hr.term_id,hr.payload_json FROM homework_targets ht JOIN homework_records hr ON hr.id=ht.record_id').all();
      for(const row of rows){
        const term=db.prepare('SELECT * FROM terms WHERE id=?').get(row.term_id);
        const t={id:term.id,academicYear:term.academic_year,name:term.name,config:JSON.parse(term.config_json)};
        const course=row.course_id?db.prepare('SELECT * FROM public_courses WHERE id=?').get(row.course_id):row.class_code?db.prepare('SELECT * FROM public_courses WHERE term_id=? AND class_code=?').get(row.term_id,row.class_code):null;
        if(course){db.prepare('UPDATE homework_targets SET course_id=?,identity_key=? WHERE record_id=? AND target_key=?').run(course.id,courseIdentity(JSON.parse(course.payload_json),t),row.record_id,row.target_key);continue;}
        // Only the one-time migration reads retired class metadata. All new
        // authorization checks use course references or the complete identity.
        if(row.class_code){
          const privateRows=db.prepare('SELECT e.private_json FROM timetable_entries e JOIN timetables tt ON tt.id=e.timetable_id WHERE tt.term_id=? AND e.private_json IS NOT NULL').all(t.id);
          const keys=[...new Set(privateRows.map(entry=>JSON.parse(entry.private_json)).filter(c=>c.teaching_class_code===row.class_code).map(c=>courseIdentity(c,t)).filter(Boolean))];
          if(keys.length===1)db.prepare('UPDATE homework_targets SET identity_key=? WHERE record_id=? AND target_key=?').run(keys[0],row.record_id,row.target_key);
        }
      }
      db.exec('COMMIT');
    }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  }
}
