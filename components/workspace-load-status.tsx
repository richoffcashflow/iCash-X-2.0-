/** A panel owns its recovery controls so a modal never hides the way to retry. */
export function WorkspaceLoadStatus({label,loading,error,hasData,updatedAt,onRetry}:{label:'buyer'|'closing'|'deal';loading:boolean;error:boolean;hasData:boolean;updatedAt:string|null;onRetry:()=>void}){
 if(error)return <div className="workspace-load-notice" role="alert"><p>{hasData?`Showing saved ${label} details. Updates could not be refreshed.`:`Could not load ${label} details.`}{hasData&&updatedAt&&<small>Last updated {new Date(updatedAt).toLocaleString('en-US',{hour12:true})}.</small>}</p><button type="button" className="workspace-quiet" disabled={loading} onClick={onRetry}>{loading?'Refreshing…':'Try again'}</button></div>;
 if(loading)return <p className="workspace-load-pending" role="status">{hasData?'Refreshing…':`Loading ${label} details…`}</p>;
 return null;
}
