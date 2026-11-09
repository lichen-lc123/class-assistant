export type Source = 'ai' | 'excel' | 'template' | 'cards';
export interface Calendar { name: string; start_date: string; end_date?:string }
export interface Period { number: number; start: string; end: string; section?:string }
export interface CalendarEvent { title:string;kind:'class'|'exam'|'holiday'|'adjustment'|'preparation'|'event';start_date:string;end_date:string|null;description:string }
export interface SchoolCalendar { title:string;institution:string;source_name:string;display_start:string|null;display_end:string|null;events:CalendarEvent[];notes:string[];warnings:string[] }
export interface Term { id: string; academicYear: string; name: string; startsOn: string | null; endsOn: string | null; revision: number; config: { calendars: Calendar[]; sourceCalendars?:Calendar[]; periods: Period[]; aliases: string[]; schoolCalendar?:SchoolCalendar } }
export interface TermList { terms: Term[]; currentTermIds: string[]; today: string; timeZone: string }
export interface WeeklyRule { calendar_name?: string | null; weeks: number[]; weekday: number | null; period_start?: number | null; period_end?: number | null; start_time?: string | null; end_time?: string | null; room?: string | null; raw?: string }
export interface SpecialDate { date: string | null; weekday?:number|null; lesson_number?: number | null; kind: string; original_date?: string | null; period_start?: number | null; period_end?: number | null; start_time?: string | null; end_time?: string | null; room?: string | null; raw?: string }
export interface ExplicitSession { date: string; start_time: string; end_time: string; room: string | null; kind?: string;lesson_number?:number|null;week?:number|null;weekday?:number|null }
export interface DateReview {date:string|null;lesson_number:number|null;action:'added'|'merged'|'weekly_preferred'|'pending';reason:string;weekly_date?:string}
export interface WeeklyDateResolution {date:string;lesson_number:number|null;special_date_index?:number|null;weekly_rule_index?:number|null;week?:number|null;action:'use_weekly_rule';reason:string}
export interface Session extends ExplicitSession { start: string; end: string; lesson_number?: number | null }
export interface CourseData {
  course_name: string; teacher?: string | null; course_code?: string | null; teaching_class_code?: string | null;
  academic_year?: string | null; semester?: string | null; room?: string | null; credits?: number | null;
  college?: string | null; required_or_elective?: string | null; course_category?: string | null;
  weekly_rules: WeeklyRule[]; special_dates: SpecialDate[]; explicit_sessions: ExplicitSession[];
  schedule_raw?: string; remarks_raw?: string; warnings?: string[];source_warnings?:string[];extra_fields?:Record<string,unknown>;source_rows?:{source:string;row:number|null;raw:string}[];
}
export interface Course extends CourseData { id: string; origin?:'template'|'manual'; creationSources?:('template'|'manual')[]; sessions: Session[]; warnings: string[];notices?:string[];date_reviews?:DateReview[]; review_status?:'confirmed';schedule_status: string; cardEnabled?: boolean; published?: boolean; revision?: number; publicCourseId?: string | null; publicRevision?:number; hasOverride?: boolean; templateSyncPaused?:boolean; hasPersonalData?: boolean; publicChanged?: boolean; matchedCourseId?: string | null;importAction?:'reuse'|'new' }
export interface Conflict { date: string; first: string; second: string; start: string; end?: string }
export interface Preview { courses: Course[]; warnings: string[]; conflicts: Conflict[];importConflicts?:Conflict[];importBlocked?:boolean;importError?:string|null;unparsedItems?:{raw:string;reason:string|null}[];importWarnings?:string[];catalogVersion?:string;selectionVersion?:string;templateName?:string;stats?:{newCourses:number;reusedCourses:number} }
export interface Timetable { id: string; source: Source; revision: number; templateId?: string | null; templateRevision?: number | null }
export interface TimetableView { term: Term; timetable: Timetable | null; courses: Course[]; conflicts: Conflict[]; today: string; serverNow: string; added?: number; skipped?: number }
export interface DashboardLesson extends Session { entryId:string;courseName:string;teacher:string|null;index:number;lessonNumber:number;termName:string;academicYear:string }
export interface DashboardDay { date:string;daysUntil:number;lessons:DashboardLesson[] }
export interface DashboardView { today:string;timeZone:string;days:DashboardDay[];pendingCourseCount:number;timetableCount:number }
export interface Template { id: string; termId: string; name: string; description: string; published: boolean; revision: number; courseIds: string[]; subscriberNames?:string[]; courses?:Course[] }
export const sourceNames: Record<Source,string> = { ai:'外部 AI 结果', excel:'历史表格导入', template:'管理员模板', cards:'课程卡片' };
export function emptyCourse(): CourseData { return { course_name:'',teacher:'',course_code:'',teaching_class_code:'',weekly_rules:[],special_dates:[],explicit_sessions:[],room:'',schedule_raw:'',remarks_raw:'' }; }
export const errorMessage=(error:unknown)=>error instanceof Error?error.message:'操作失败，请重试。';
