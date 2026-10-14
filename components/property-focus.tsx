import type {ReactNode} from 'react';

/** One current state, with an action only when the user has something to do. */
export function PropertyFocus({title,detail,children}:{title:string;detail?:string;children?:ReactNode}){
 return <section className="property-focus" aria-label="Current step"><div><h3>{title}</h3>{detail&&<p>{detail}</p>}</div>{children&&<div className="property-focus-action">{children}</div>}</section>;
}
