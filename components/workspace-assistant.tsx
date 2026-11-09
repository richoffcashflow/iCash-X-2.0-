'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUp,ArrowUpRight,MessageCircle,Sparkles,X} from 'lucide-react';
import {FundingDialog} from '@/components/funding-dialog';
import {AssistantTextAction} from './assistant-text-action';
import type {AssistantAction,AssistantAnswer} from '@/lib/workspace-assistant-policy';
export type AssistantRequest={screeningId:string;address:string;nonce:number;mode?:'compose'|'explain_offer'};
type Reply={id:string;question:string;answer:AssistantAnswer|null;state:string;created_at:string};
type Props={onVipRequired?:()=>void;request:AssistantRequest|null;openRequest?:number;stale:boolean;onAction:(action:AssistantAction)=>Promise<void>|void};
const suggestions=['Help me close a deal','How should I handle a buyer objection?','What needs me?'];
const propertySuggestions=['What is the next step for this deal?','Help me reply to the seller','Help me with the buyer','Explain this offer'];
export function WorkspaceAssistant({request,openRequest=0,stale,onAction,onVipRequired}:Props){
 const [open,setOpen]=useState(false),[question,setQuestion]=useState(''),[items,setItems]=useState<Reply[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false),[context,setContext]=useState<AssistantRequest|null>(null),[actionBusy,setActionBusy]=useState(false);
 const inFlight=useRef(false),loaded=useRef(false),alive=useRef(true),handled=useRef<number|null>(null),historyView=useRef<HTMLDivElement>(null),controller=useRef<AbortController|null>(null);
 const currentContext=useRef(context?.screeningId);currentContext.current=context?.screeningId;
 const pending=useRef<{requestId:string;question:string;screeningId?:string}|null>(null);
 const [textAction,setTextAction]=useState<{questionId:string;actionIndex:number;action:AssistantAction}|null>(null);
 useEffect(()=>{alive.current=true;const selected=new URLSearchParams(window.location.search).get('assistant');if(selected)setOpen(true);return()=>{alive.current=false;controller.current?.abort();};},[]);
 useEffect(()=>{if(openRequest)setOpen(true);},[openRequest]);
 async function history(){setLoading(true);try{const id=new URLSearchParams(window.location.search).get('assistant');const r=await fetch('/api/work/assistant'+(id?'?id='+encodeURIComponent(id):''),{cache:'no-store'});const value=await r.json();if(!alive.current)return;if(!r.ok){if(r.status===403&&value.code==='VIP_REQUIRED')onVipRequired?.();throw Error(value.error);}if(alive.current){setItems(previous=>{const merged=new Map(previous.map(item=>[item.id,item]));for(const item of value.items as Reply[]){if(!merged.get(item.id)?.answer||item.answer)merged.set(item.id,item);}return [...merged.values()].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));});loaded.current=true;setError('');}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not load replies.');}finally{if(alive.current)setLoading(false);}}
 useEffect(()=>{if(open&&!loaded.current)void history();},[open]);
 useEffect(()=>{const node=historyView.current;if(!open||!node)return;if(busy){node.scrollTop=node.scrollHeight;return;}const latest=node.querySelector<HTMLElement>('.assistant-exchange:last-of-type');node.scrollTop=latest?node.scrollTop+latest.getBoundingClientRect().top-node.getBoundingClientRect().top-20:0;},[items,busy,open,context?.screeningId]);
 async function ask(value=question,selected=context){
  const text=value.trim();if(!text||inFlight.current||stale)return;
  inFlight.current=true;setBusy(true);setOpen(true);setError('');
  const previous=pending.current;
  const attempt=previous?.question===text&&previous.screeningId===selected?.screeningId?previous:{requestId:crypto.randomUUID(),question:text,...(selected?{screeningId:selected.screeningId}:{})};pending.current=attempt;
  controller.current=new AbortController();const timer=setTimeout(()=>controller.current?.abort(),55000);
  try{
   const r=await fetch('/api/work/assistant',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.current.signal,body:JSON.stringify({...attempt,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'})});const value=await r.json();
   if(!alive.current)return;
   if(!r.ok){if([400,401,402,403,404,409,413,429].includes(r.status))pending.current=null;if(r.status===403&&value.code==='VIP_REQUIRED')onVipRequired?.();throw Error(value.error);}
   if(r.status===202){setError('Your reply is still being saved. Check replies in a moment.');return;}
   if(typeof value.answer?.text!=='string'||!Array.isArray(value.answer.actions))throw Error('Could not confirm your reply. Check replies before trying again.');
   setItems(previous=>[...previous.filter(item=>item.id!==value.id),value]);setQuestion(current=>attempt.screeningId===currentContext.current&&current.trim()===text?'':current);pending.current=null;loaded.current=true;
  }catch(e){if(alive.current)setError(e instanceof Error&&e.name!=='AbortError'?e.message:'This reply is taking longer than expected. Check replies before trying again.');}
  finally{clearTimeout(timer);inFlight.current=false;if(alive.current)setBusy(false);}
 }
 useEffect(()=>{if(!request||handled.current===request.nonce)return;handled.current=request.nonce;setTextAction(null);setContext(request);setOpen(true);const initialQuestion=request.mode==='compose'?'':'Explain this offer';setQuestion(initialQuestion);if(initialQuestion&&!inFlight.current)void ask(initialQuestion,request);},[request]);
 async function act(action:AssistantAction,questionId?:string,actionIndex?:number){if(actionBusy||stale)return;if(action.draft&&questionId&&actionIndex!==undefined){setTextAction({questionId,actionIndex,action});return;}setActionBusy(true);setError('');try{await onAction(action);if(['property','attention','funding'].includes(action.kind))setOpen(false);}catch(e){setError(e instanceof Error?e.message:'Could not complete that action.');}finally{setActionBusy(false);}}
 const visibleItems=context?items.filter(item=>item.answer?.propertyId===context.screeningId):items;
 const propertyContext=context&&<div className="assistant-property-context"><span>{context.address}</span><button type="button" aria-label="Clear property context" onClick={()=>{setContext(null);setTextAction(null);}}><X size={14}/></button></div>;
 const composer=(dock:boolean)=><form className="assistant-composer" data-credit-action onSubmit={event=>{event.preventDefault();void ask();}}>
  {dock?<button type="button" className="assistant-toggle" aria-label="Open bot conversation" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><MessageCircle size={20}/></button>:<span className="assistant-toggle" aria-hidden="true"><MessageCircle size={20}/></span>}
  <label className="sr-only" htmlFor={dock?'ask-bot-dock-question':'ask-bot-question'}>Ask AI Bot</label><input id={dock?'ask-bot-dock-question':'ask-bot-question'} data-credit-action value={question} maxLength={1500} placeholder="Ask about your next move…" autoComplete="off" enterKeyHint="send" disabled={stale} onChange={event=>setQuestion(event.target.value)}/>
  <button type="submit" data-credit-action className="assistant-send" aria-label="Send question" disabled={busy||stale||!question.trim()}><ArrowUp size={19}/></button>
 </form>;
 return <>
 <section className="workspace-assistant assistant-dock" aria-label="Message your AI bot">{propertyContext}{composer(true)}</section>
 {open&&<FundingDialog className="assistant-dialog" title="Ask AI Bot" onClose={()=>setOpen(false)}><section id="ask-bot" className="workspace-assistant is-open" aria-label="Ask AI Bot">
  <div className="assistant-panel" id="assistant-replies">
   <div className="assistant-coach-intro"><span className="assistant-coach-icon"><Sparkles size={19}/></span><div><strong>Your deal coach</strong><p>Seller strategy. Buyer replies. A clear next move.</p></div><span className="assistant-coach-badge">VIP</span></div>
   <div ref={historyView} className="assistant-history" role="log" aria-label="Bot replies" aria-live="polite" aria-relevant="additions">
    {!visibleItems.length&&!loading&&<div className="assistant-welcome"><strong>Let’s move your deal forward.</strong><p>Tell me what the seller or buyer said. I’ll help you decide what to do and prepare the next step. Replies use work credits at your VIP rate.</p></div>}
    {loading&&<p className="assistant-checking" role="status">Loading saved replies…</p>}
    {visibleItems.map(item=><article className="assistant-exchange" key={item.id}><p className="assistant-question">{item.question}</p>{item.answer?<><AssistantResponse answer={item.answer}/>{!!item.answer.actions.length&&<p className="assistant-action-intro">Want a hand with the next step?</p>}<div className="assistant-answer-actions">{item.answer.actions.map((action,index)=><button type="button" key={index} disabled={actionBusy||stale} onClick={()=>void act(action,item.id,index)}>{action.label}<ArrowUpRight size={14} aria-hidden="true"/></button>)}</div><a className="assistant-reply-date" href={`/?assistant=${encodeURIComponent(item.id)}#ask-bot`}>{new Date(item.answer.checkedAt).toLocaleString('en-US',{hour12:true,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</a></>:<p className="assistant-checking">{item.state==='pending'?'Reply is still processing.':'This reply could not finish. Ask again to retry.'}</p>}</article>)}
    {busy&&<p className="assistant-checking" role="status"><span className="assistant-loading-dots" aria-hidden="true"><i/><i/><i/></span>Reviewing the conversation and next steps…</p>}
   </div>
   {textAction&&<AssistantTextAction key={textAction.questionId+":"+textAction.actionIndex} questionId={textAction.questionId} actionIndex={textAction.actionIndex} stale={stale} onClose={()=>setTextAction(null)} onConversation={()=>void act({...textAction.action,draft:undefined})}/> }
   <div className="assistant-suggestions" data-credit-action>{(context?propertySuggestions:suggestions).map(value=><button key={value} type="button" disabled={busy||stale} onClick={()=>void ask(value,context)}>{value}</button>)}</div>
   {error&&<p className="assistant-error" role="alert">{error} <button type="button" disabled={loading} onClick={()=>void history()}>Check replies</button></p>}
  </div>
  {propertyContext}{composer(false)}
 </section></FundingDialog>}
 </>;
}

function AssistantResponse({answer}:{answer:AssistantAnswer}){
 const coach=answer.coaching;
 if(!coach)return <p className="assistant-answer">{answer.text}</p>;
 return <div className="assistant-coaching">
  <section className="assistant-next-move" aria-label="Recommended next move"><span>Your next move</span><h3>{coach.recommendation}</h3>{coach.reason&&<p>{coach.reason}</p>}</section>
  {!!coach.steps.length&&<ol className="assistant-coach-steps">{coach.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>}
  {coach.question&&<p className="assistant-coach-question">{coach.question}</p>}
  {coach.draft&&<section className="assistant-suggested-message"><span>Suggested {coach.draft.party==='buyer'?'buyer':'seller'} reply</span><blockquote>{coach.draft.body}</blockquote><small>Review and edit before sending.</small></section>}
 </div>;
}
