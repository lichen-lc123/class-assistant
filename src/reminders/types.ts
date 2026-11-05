export interface ReminderPreferences {
  courseEnabled:boolean;courseLeadMinutes:number;courseChangesEnabled:boolean;
  homeworkUpdatesEnabled:boolean;homeworkDueEnabled:boolean;homeworkLeadMinutes:number;
  remindOfficialDeadline:boolean;remindPersonalPlan:boolean;
}
export interface ReminderSettings extends ReminderPreferences {revision:number;updatedAt:string|null;deliveryStatus:'not_connected'}
export function reminderPayload(settings:ReminderSettings):ReminderPreferences&{revision:number}{
  const {courseEnabled,courseLeadMinutes,courseChangesEnabled,homeworkUpdatesEnabled,homeworkDueEnabled,homeworkLeadMinutes,remindOfficialDeadline,remindPersonalPlan,revision}=settings;
  return{courseEnabled,courseLeadMinutes,courseChangesEnabled,homeworkUpdatesEnabled,homeworkDueEnabled,homeworkLeadMinutes,remindOfficialDeadline,remindPersonalPlan,revision};
}
