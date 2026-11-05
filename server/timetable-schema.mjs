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
}
