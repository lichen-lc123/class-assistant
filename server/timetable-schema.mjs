export function initTimetableSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS terms (
      id TEXT PRIMARY KEY, academic_year TEXT NOT NULL, name TEXT NOT NULL,
      starts_on TEXT, ends_on TEXT, config_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(academic_year,name)
    );
    CREATE TABLE IF NOT EXISTS public_courses (
      id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id),
      class_code TEXT, payload_json TEXT NOT NULL,
      card_enabled INTEGER NOT NULL DEFAULT 1, published INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(term_id,class_code)
    );
    CREATE TABLE IF NOT EXISTS timetable_templates (
      id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id),
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS template_courses (
      template_id TEXT NOT NULL REFERENCES timetable_templates(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES public_courses(id),
      PRIMARY KEY(template_id,course_id)
    );
    CREATE TABLE IF NOT EXISTS timetables (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      term_id TEXT NOT NULL REFERENCES terms(id),
      source TEXT NOT NULL CHECK(source IN ('ai','excel','template','cards')),
      template_id TEXT REFERENCES timetable_templates(id) ON DELETE SET NULL,
      template_revision INTEGER, revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(user_id,term_id)
    );
    CREATE TABLE IF NOT EXISTS timetable_entries (
      id TEXT PRIMARY KEY, timetable_id TEXT NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
      course_id TEXT REFERENCES public_courses(id), private_json TEXT, override_json TEXT,
      base_revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS public_courses_term ON public_courses(term_id);
    CREATE INDEX IF NOT EXISTS timetable_entries_parent ON timetable_entries(timetable_id);
    CREATE INDEX IF NOT EXISTS timetable_entries_course ON timetable_entries(course_id);
  `);
  const legacy=!db.prepare('PRAGMA table_info(timetable_entries)').all().some(c=>c.name==='direct_source');
  const needsTemplateCreator=!db.prepare('PRAGMA table_info(timetable_templates)').all().some(c=>c.name==='created_by');
  const needsOrigin=!db.prepare('PRAGMA table_info(public_courses)').all().some(c=>c.name==='origin');
  const needsTemplateSnapshot=!db.prepare('PRAGMA table_info(template_courses)').all().some(c=>c.name==='course_snapshot_json');
  const needsEntrySnapshot=!db.prepare('PRAGMA table_info(timetable_entries)').all().some(c=>c.name==='base_snapshot_json');
  try {db.exec(`
    BEGIN IMMEDIATE;
    ${needsTemplateCreator?'ALTER TABLE timetable_templates ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;':''}
    ${legacy?'ALTER TABLE timetable_entries ADD COLUMN direct_source TEXT;':''}
    ${needsOrigin?`ALTER TABLE public_courses ADD COLUMN origin TEXT NOT NULL DEFAULT 'template' CHECK(origin IN ('template','manual'));
    UPDATE public_courses SET origin='manual' WHERE NOT EXISTS(SELECT 1 FROM template_courses tc WHERE tc.course_id=public_courses.id);`:''}
    ${needsTemplateSnapshot?'ALTER TABLE template_courses ADD COLUMN course_snapshot_json TEXT;':''}
    ${needsEntrySnapshot?'ALTER TABLE timetable_entries ADD COLUMN base_snapshot_json TEXT;':''}
    CREATE TABLE IF NOT EXISTS timetable_template_subscriptions (
      timetable_id TEXT NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
      template_id TEXT NOT NULL REFERENCES timetable_templates(id) ON DELETE CASCADE,
      template_revision INTEGER NOT NULL,
      PRIMARY KEY(timetable_id,template_id)
    );
    CREATE TABLE IF NOT EXISTS timetable_entry_templates (
      entry_id TEXT NOT NULL REFERENCES timetable_entries(id) ON DELETE CASCADE,
      template_id TEXT NOT NULL REFERENCES timetable_templates(id) ON DELETE CASCADE,
      PRIMARY KEY(entry_id,template_id)
    );
    ${legacy?`UPDATE timetable_entries SET direct_source=(SELECT source FROM timetables WHERE id=timetable_id) WHERE timetable_id IN (SELECT id FROM timetables WHERE source<>'template');
    INSERT OR IGNORE INTO timetable_template_subscriptions SELECT id,template_id,COALESCE(template_revision,0) FROM timetables WHERE source='template' AND template_id IS NOT NULL;
    INSERT OR IGNORE INTO timetable_entry_templates SELECT e.id,t.template_id FROM timetable_entries e JOIN timetables t ON t.id=e.timetable_id WHERE t.source='template' AND t.template_id IS NOT NULL AND e.course_id IS NOT NULL;`:''}
    COMMIT;
  `);}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
}
