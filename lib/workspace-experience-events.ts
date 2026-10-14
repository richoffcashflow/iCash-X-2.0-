/** Fixed, non-content diagnostic labels. Never pass URLs, names or error text. */
export const workspaceExperienceEvents=['panel_error','panel_retry','panel_open','action_complete'] as const;
export const workspaceExperienceStages=['workspace','property','buyers','buyer_details','documents','closing','messages','account'] as const;
export type WorkspaceExperienceEvent=typeof workspaceExperienceEvents[number];
export type WorkspaceExperienceStage=typeof workspaceExperienceStages[number];
export type WorkspaceExperienceInput={event:WorkspaceExperienceEvent;stage:WorkspaceExperienceStage};
