import type { Term, CalendarEvent } from '../src/timetable/types';
export const calendarKindNames: Readonly<Record<CalendarEvent['kind'], string>>;
export interface CalendarWeekRow { start:string; end:string; weeks:{name:string;week:number}[]; days:{date:string;outside:boolean;events:CalendarEvent[]}[] }
export function calendarWeekRows(term: Pick<Term, 'startsOn'|'endsOn'|'config'>): CalendarWeekRow[];
export function academicCalendarWarnings(term: Pick<Term, 'startsOn'|'endsOn'|'config'>): string[];
