const dateKey=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:'9999-99-99';
const timeKey=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value)?value:'99:99';

export function chronologicalLessons(lessons){
 return [...lessons].sort((a,b)=>dateKey(a.date).localeCompare(dateKey(b.date))||timeKey(a.start_time).localeCompare(timeKey(b.start_time))||timeKey(a.end_time).localeCompare(timeKey(b.end_time)));
}
export function numberLessons(lessons){
 return chronologicalLessons(lessons).map((lesson,index)=>({...lesson,lesson_number:index+1}));
}
