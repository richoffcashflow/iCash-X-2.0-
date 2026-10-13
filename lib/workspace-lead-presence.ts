/** An empty search or later page cannot establish an empty account. */
export function workspaceLeadPresence(input:{loaded:boolean;loading:boolean;error:boolean;count:number;hasMore:boolean;page:number;query:string;focusedId:string}):boolean|undefined {
 if(!input.loaded||input.loading||input.error)return undefined;
 if(input.count>0||input.hasMore)return true;
 if(input.page!==0||input.query.trim()||input.focusedId)return undefined;
 return false;
}
