/** A panel owns its recovery controls so a modal never hides the way to retry. */
export function WorkspaceLoadStatus({label,loading,error,hasData,onRetry}:{label:'buyer'|'closing'|'deal';loading:boolean;error:boolean;hasData:boolean;updatedAt:string|null;onRetry:()=>void}){
 // A background read never replaces saved details with a technical warning.
 if(hasData)return null;
 if(error)return <button type="button" className="workspace-quiet" aria-label={`Refresh ${label} details`} disabled={loading} onClick={onRetry}>Refresh</button>;
 if(loading)return <p className="workspace-load-pending" role="status">Loading {label} details…</p>;
 return null;
}
