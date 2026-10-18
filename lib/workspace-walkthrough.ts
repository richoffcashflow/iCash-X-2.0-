import {z} from 'zod';

export const walkthroughVersion=1;
export const walkthroughSteps=[
 {target:'workspace-tour-course',title:'First, watch the course.',detail:'Start with the course to learn how iCash X works, from your first lead to closing. Come back here for a quick tour of your workspace.'},
 {target:'workspace-tour-controls',title:'Your bot, at a glance.',detail:'See your credits and bot status here. Save your account details and add money when you’re ready to start. Use Pause to stop new work and Run bot to resume.'},
 {target:'workspace-properties',title:'Follow your deals here.',detail:'Your properties and updates appear here. Open a property for Calls, Texts and Documents. When a decision needs your attention, look for “Needs you.”'},
 {target:'workspace-tour-menu',title:'Help is always close.',detail:'Open this menu for Help, settings or this walkthrough. The Course button stays at the top whenever you need a refresher.'},
] as const;
export const walkthroughInput=z.object({step:z.number().int().min(0).max(walkthroughSteps.length-1),state:z.enum(['active','dismissed','completed'])}).strict().refine(value=>value.state!=='completed'||value.step===walkthroughSteps.length-1);
export const walkthroughState=z.object({step:z.number().int().min(0).max(walkthroughSteps.length-1),state:z.enum(['new','available','active','dismissed','completed'])}).strict();
export type WalkthroughState=z.infer<typeof walkthroughState>;
