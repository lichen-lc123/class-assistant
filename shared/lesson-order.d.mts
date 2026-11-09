type LessonTime={date?:string|null;start_time?:string|null;end_time?:string|null};
export function chronologicalLessons<T extends LessonTime>(lessons:T[]):T[];
export function numberLessons<T extends LessonTime>(lessons:T[]):(T&{lesson_number:number})[];
