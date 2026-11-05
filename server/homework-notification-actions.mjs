// A channel-independent action contract for the future mobile sender. It does
// not send a notification or grant access without the user's normal session.
export function homeworkCompletionAction(record){
  return{
    action:'complete-homework',title:'完成',
    openUrl:`/?completeHomework=${encodeURIComponent(record.id)}&homeworkRevision=${record.revision}`,
    request:{method:'POST',path:`/api/homework/records/${record.id}/completion`,body:{completed:true,revision:record.revision}},
  };
}
