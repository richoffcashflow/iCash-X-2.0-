import {z} from 'zod';
import {workspaceExperienceEvents,workspaceExperienceStages} from './workspace-experience-events.ts';
export const workspaceExperienceSchema=z.object({event:z.enum(workspaceExperienceEvents),stage:z.enum(workspaceExperienceStages)}).strict();
export const workspaceExperienceSummarySchema=z.object({
 days:z.literal(7),lastObservedAt:z.string().datetime({offset:true}).nullable(),
 counts:z.array(z.object({event:z.enum(workspaceExperienceEvents),stage:z.enum(workspaceExperienceStages),count:z.number().int().nonnegative(),accounts:z.number().int().nonnegative()}).strict()).max(32),
}).strict();
export type WorkspaceExperienceSummary=z.infer<typeof workspaceExperienceSummarySchema>;
