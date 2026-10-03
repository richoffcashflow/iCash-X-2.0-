export const exceptionSources = ['billing','costs','texts','emails','voice_jobs','call_results','property_checks','title_tasks','attention_emails','support'] as const;
export type ExceptionSource = typeof exceptionSources[number];
export const exceptionLabels: Record<ExceptionSource,string> = {
 billing:'Payments and cancellation',costs:'Cost reconciliation',texts:'Text delivery',emails:'Deal email delivery',
 voice_jobs:'Call dispatch',call_results:'Call results',property_checks:'Property checks',title_tasks:'Title and closing',
 attention_emails:'Customer alert delivery',support:'Escalated support',
};
export const exceptionPageSize = 20;
export const exceptionMaxPage = 1000;
export type ExceptionItem = {key:string;recordId:string;accountId:string;source:ExceptionSource;state:string;priority:'attention'|'review';title:string;detail:string;nextStep:string;recordedAt:string;dueDate?:string};
export type ExceptionSection = {source:ExceptionSource;label:string;status:'checked'|'unavailable';items:ExceptionItem[];hasMore:boolean;page:number};
export type ExceptionSnapshot = {observedAt:string;sections:ExceptionSection[];partial:boolean;scope:'provisioned_support_operator';dateTimezone:'America/Chicago'};
