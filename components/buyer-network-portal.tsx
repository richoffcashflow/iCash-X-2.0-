'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowUpRight,Check,House,Mail,SlidersHorizontal} from 'lucide-react';
import {webinarRequest,webinarPost} from '@/lib/webinar-client';
import {networkConsentText,networkConsentVersion,type NetworkProfile,type NetworkMatch} from '@/lib/buyer-network';
import {BuyerMatchFeedback} from './buyer-match-feedback';
import styles from './buyer-network.module.css';
type Portal={signedIn:boolean;email?:string;profile?:NetworkProfile|null;matches?:NetworkMatch[]};
const money=(cents:number)=>(cents/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});

export function BuyerNetworkPortal(){
 const locked=useRef(false);
 const [data,setData]=useState<Portal|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[codeSent,setCodeSent]=useState(false),[editing,setEditing]=useState(false);
 const [available,setAvailable]=useState('');
 const [name,setName]=useState(''),[zips,setZips]=useState(''),[price,setPrice]=useState(''),[repairs,setRepairs]=useState(''),[house,setHouse]=useState(true),[land,setLand]=useState(false),[daily,setDaily]=useState(3),[accepted,setAccepted]=useState(false);
 function receive(next:Portal){setData(next);if(next.profile){const p=next.profile;setName(p.name);setZips(p.zips.join(', '));setPrice(String(p.maxPriceCents/100));setRepairs(String(p.maxRepairsCents/100));setHouse(p.propertyTypes.includes('house'));setLand(p.propertyTypes.includes('land'));setDaily(p.dailyEmails);setAvailable(p.availableDeals==null?'':String(p.availableDeals));}setEditing(!next.profile);}
 async function refresh(){receive(await webinarRequest<Portal>('/api/buyer-network',{cache:'no-store'}));}
 useEffect(()=>{const abort=new AbortController();void webinarRequest<Portal>('/api/buyer-network',{signal:abort.signal,cache:'no-store'}).then(receive).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[]);
 async function action(run:()=>Promise<void>){if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');try{await run();}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{locked.current=false;setBusy(false);}}
 function authenticate(e:FormEvent){e.preventDefault();void action(async()=>{
  await webinarPost('/api/buyer-network/auth',codeSent?{action:'verify',email,code}:{action:'send',email});
  if(codeSent){await refresh();setCode('');}else{setCodeSent(true);setNotice('Check your email for a sign-in code.');}
 });}
 function save(e:FormEvent){e.preventDefault();void action(async()=>{
  await webinarPost('/api/buyer-network',{name,zips:zips.split(/[\s,]+/).filter(Boolean),propertyTypes:[...(house?['house']:[]),...(land?['land']:[])],maxPriceCents:Number(price)*100,maxRepairsCents:Number(repairs)*100,dailyEmails:daily,availableDeals:available===''?null:Number(available),accepted,consentVersion:networkConsentVersion});
  await refresh();setAccepted(false);setNotice('You’re in. Matching deals will appear here and arrive by email.');
 });}
 async function respond(matchId:string,state:'interested'|'passed'){
  await webinarRequest('/api/buyer-network',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({matchId,state})});
  await refresh();setNotice(state==='interested'?'Your interest is saved for the deal owner. You can also reply to the package email.':'Deal passed. We’ll keep looking for your next match.');
 }
 const expired=!!data?.profile&&Date.parse(data.profile.expiresAt)<=Date.now(),paused=data?.profile?.paused===true;
 return <main className={styles.page}>
  <header className={styles.header}><a className={styles.brand} href="/sell"><House size={22} aria-hidden="true"/><span>HomeOffer<span>NETWORK</span></span></a><span className={styles.pill}>Free buyer access</span></header>
  <section className={styles.hero}><span className={styles.eyebrow}>YOUR NEXT OPPORTUNITY</span><h1>Off-market deals.<br/>In your buying range.</h1><p>Tell us where you buy. Get property photos, pricing and deal details in one package when a match is available.</p></section>
  {error&&<div className={styles.alert} role="alert">{error}{!data&&<button type="button" onClick={()=>void action(refresh)}>Retry</button>}</div>}
  {notice&&<p className={styles.notice} role="status"><Check size={18} aria-hidden="true"/>{notice}</p>}
  {!data&&!error&&<p role="status">Opening buyer access…</p>}
  {data&&!data.signedIn&&<section className={styles.card}><div className={styles.cardHeading}><Mail size={22} aria-hidden="true"/><div><h2>{codeSent?'Check your inbox':'Start with your email'}</h2><p>No subscription. No payment details.</p></div></div>
   <form onSubmit={authenticate} className={styles.form}><label>Email address<input type="email" autoComplete="email" required maxLength={320} value={email} disabled={busy||codeSent} onChange={e=>setEmail(e.target.value)}/></label>
    {codeSent&&<label>Email code<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,10}" required value={code} onChange={e=>setCode(e.target.value)}/></label>}
    <button className={styles.primary} disabled={busy}>{busy?'Please wait…':codeSent?'Verify email':'Email me a code'}<ArrowUpRight size={18} aria-hidden="true"/></button>
    {codeSent&&<button className={styles.quiet} type="button" disabled={busy} onClick={()=>{setCodeSent(false);setCode('');setNotice('');}}>Change email or request a new code</button>}
   </form><p className={styles.fine}>Verifying your email does not subscribe you to property emails. You choose that in the next step.</p>
  </section>}
  {data?.signedIn&&<>
   <div className={styles.session}><span>{data.email}</span><button type="button" className={styles.quiet} disabled={busy} onClick={()=>void action(async()=>{await webinarPost('/api/auth/logout',{});await refresh();setAccepted(false);setCodeSent(false);})}>Sign out</button></div>
   {data.profile&&<section className={styles.card}><div className={styles.cardHeading}><SlidersHorizontal size={22} aria-hidden="true"/><div><h2>{paused?'Matching paused':expired?'Refresh your buying preferences':'Your buying preferences'}</h2><p>{data.profile.zips.join(' · ')} · Up to {money(data.profile.maxPriceCents)}</p></div></div>
    <p className={styles.fine}>{paused?'You won’t receive new network emails until you rejoin.':expired?'Confirm you’re still buying to resume matching.':`Active through ${new Date(data.profile.expiresAt).toLocaleDateString('en-US')}. Up to ${data.profile.dailyEmails} package emails per day.`}</p>
    <div className={styles.actions}><button type="button" className={styles.secondary} onClick={()=>setEditing(v=>!v)}>{editing?'Close preferences':paused||expired?'Renew preferences':'Edit preferences'}</button>{!paused&&<button className={styles.quiet} type="button" disabled={busy} onClick={()=>void action(async()=>{await webinarRequest('/api/buyer-network',{method:'DELETE'});await refresh();setNotice('Network emails stopped.');})}>Pause emails</button>}</div>
   </section>}
   {editing&&<section className={styles.card}><h2>What are you buying?</h2><form className={styles.form} onSubmit={save}>
    <label>Your name or company<input required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>ZIP codes<input required placeholder="75201, 75204, 75206" value={zips} onChange={e=>setZips(e.target.value)}/><small>Enter up to 20 five-digit ZIP codes, separated by commas.</small></label>
    <fieldset><legend>Property types</legend><div className={styles.checkRow}><label><input type="checkbox" checked={house} onChange={e=>setHouse(e.target.checked)}/>Houses</label><label><input type="checkbox" checked={land} onChange={e=>setLand(e.target.checked)}/>Land</label></div></fieldset>
    <div className={styles.twoColumns}><label>Maximum purchase price ($)<input type="number" min={1000} max={100000000} step={1000} inputMode="numeric" required value={price} onChange={e=>setPrice(e.target.value)}/></label><label>Maximum repair budget ($)<input type="number" min={0} max={100000000} step={1000} inputMode="numeric" required value={repairs} onChange={e=>setRepairs(e.target.value)}/></label></div>
    <label>How many properties can you buy in the next 30 days?<input type="number" min={0} max={100} step={1} value={available} onChange={e=>setAvailable(e.target.value)}/><small>Optional. Enter 0 if you are not buying right now. This is your stated capacity; funds are verified separately.</small></label>
    <label>Maximum package emails per day<select value={daily} onChange={e=>setDaily(Number(e.target.value))}><option value={1}>1 per day</option><option value={2}>2 per day</option><option value={3}>3 per day</option></select></label>
    <label className={styles.consent}><input type="checkbox" checked={accepted} required onChange={e=>setAccepted(e.target.checked)}/><span>{networkConsentText} <a href="/buyers/privacy" target="_blank" rel="noreferrer">Privacy & contact choices</a></span></label>
    <button className={styles.primary} disabled={busy||!accepted||!house&&!land}>{busy?'Saving…':data.profile?'Save & renew for 30 days':'Join the buyer network'}<ArrowUpRight size={18} aria-hidden="true"/></button>
   </form></section>}
   {data.profile&&!paused&&!expired&&<section className={styles.matches}><div className={styles.sectionHeading}><h2>Your matches <span>{data.matches?.length??0}</span></h2><button className={styles.quiet} type="button" disabled={busy} onClick={()=>void action(refresh)}>Refresh</button></div>
    {!data.matches?.length?<div className={styles.empty}><House size={30} aria-hidden="true"/><h3>We’re looking for your next deal.</h3><p>New matches appear when participating members release eligible properties in your ZIP codes.</p></div>:data.matches.map(m=><article className={styles.card} key={m.id}><span className={styles.eyebrow}>{m.state==='interested'?'INTEREST SENT':'OFF-MARKET MATCH'}</span><h3>{m.address}</h3><p className={styles.price}>{money(m.askingPriceCents)}</p><p className={styles.fine}>Buyer pays closing costs. Review the package for terms, photos and available viewing times.</p><a className={styles.packageLink} href={m.url} target="_blank" rel="noreferrer">View property package<ArrowUpRight size={18} aria-hidden="true"/></a><div className={styles.actions}><button className={styles.primary} disabled={busy||m.state==='interested'} type="button" onClick={()=>void action(()=>respond(m.id,'interested'))}>{m.state==='interested'?'Interest sent':'I’m interested'}</button><button className={styles.quiet} type="button" disabled={busy} onClick={()=>void action(()=>respond(m.id,'passed'))}>Pass</button></div><BuyerMatchFeedback matchId={m.id} onSaved={refresh}/></article>)}
   </section>}
  </>}
  <footer className={styles.footer}>Buying preferences help us match properties. Funds, signing authority and purchase terms are confirmed separately before an assignment.</footer>
 </main>;
}
