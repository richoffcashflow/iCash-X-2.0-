import type {IntelligenceMetric,IntelligencePlan} from '../packages/webinar-engine/src/intelligence.ts';
export type WebinarIntelligenceReport={
 context:string;ad:string;generatedAt:string;enabled:boolean;metricsAvailable:boolean;plan:IntelligencePlan;
 arms:{key:string;webinarId:string;revision:number;version:'day'|'night';title:string}[];
 rows:IntelligenceMetric[];ads:{ad_key:string;visitors:number}[];
 comparison:null|{holdout_visitors:number;holdout_buyers:number;holdout_value_cents:number;adaptive_visitors:number;adaptive_buyers:number;adaptive_value_cents:number};
};
export const intelligenceContexts={'new:day':'New visitors · daytime','new:night':'New visitors · nighttime','returning:day':'Returning visitors · daytime','returning:night':'Returning visitors · nighttime'} as const;
export const metaWebinarParameters='utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}';
