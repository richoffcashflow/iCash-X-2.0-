export type TitleCompanyReply={id:string;sender:string;subject:string;body_text:string;received_at:string;needs_review:boolean};
const time=(value:string)=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-US',{hour12:true}):'Time unavailable';

/** Received correspondence stays readable without treating its content as verified closing evidence. */
export function TitleCompanyMessages({replies}:{replies:TitleCompanyReply[]}){
 const ordered=[...replies].sort((a,b)=>(Date.parse(b.received_at)||0)-(Date.parse(a.received_at)||0));
 const latest=ordered[0];
 return <section className="title-company-messages" aria-label="Title company messages"><h4>Title company messages</h4>
  {latest?<><article className="title-latest-reply"><small>Latest from {latest.sender} · {time(latest.received_at)}</small><strong>{latest.subject||'Message from your closing office'}</strong><p className="title-message-preview">{latest.body_text}</p>{latest.needs_review&&<span className="title-message-review">Needs your review</span>}</article>
   <details className="title-message-history"><summary>View all messages ({ordered.length})</summary>{ordered.map(reply=><article key={reply.id}><small>{reply.sender} · {time(reply.received_at)}</small><strong>{reply.subject||'Message from your closing office'}</strong><p>{reply.body_text}</p></article>)}<small>Verify deadlines and payment instructions with your closer.</small></details>
  </>:<p>No title company messages yet. Replies will appear here when your closing office responds.</p>}
 </section>;
}
