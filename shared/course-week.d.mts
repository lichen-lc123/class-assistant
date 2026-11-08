type TeachingCalendar={name:string;start_date:string;end_date?:string};
type TeachingTerm={startsOn?:string|null;endsOn?:string|null;config?:{calendars?:TeachingCalendar[]}};
export function primaryTeachingCalendar(term:TeachingTerm):TeachingCalendar|null;
export function semesterCalendarConfig(config:{calendars?:TeachingCalendar[];sourceCalendars?:TeachingCalendar[];[key:string]:unknown},startsOn?:string|null,endsOn?:string|null):{calendars:TeachingCalendar[];sourceCalendars?:TeachingCalendar[];[key:string]:unknown};
export function courseTeachingWeek(date:string,course:{explicit_sessions?:{date:string;week?:number|null}[];weekly_rules?:{calendar_name?:string|null}[]},term:TeachingTerm):number|null;
