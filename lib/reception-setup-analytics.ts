import {boundedBody,receptionTarget} from './general-reception.ts';

// Fixed, read-only diagnostic of the ONE held branch-create attempt.
// POST is the provider's documented read method, not a provider mutation:
// https://elevenlabs.io/docs/api-reference/analytics/workspace/requests
// Its published response has dynamic column names, not a fixed field schema.
// Only unambiguous timestamp/method/path/status_code labels are interpreted.
// Never infer a create outcome from position, a search hit or outer HTTP 200.
const start=Date.parse('2026-10-02T18:08:20Z'),end=Date.parse('2026-10-02T18:09:00Z');
const path=`/v1/convai/agents/${receptionTarget.agentId}/branches`;
const endpoint='https://api.us.elevenlabs.io/v1/workspace/analytics/requests';
type Obj=Record<string,unknown>;
export type ReceptionSetupAnalytics={status:'matched'|'unavailable'|'ambiguous';httpStatus?:number;method?:'POST';path?:string;schemaColumns?:string[]};
type Env={ELEVENLABS_API_KEY?:string};
type Deps={rpc:(name:string,body?:Obj)=>Promise<unknown>;fetcher?:typeof fetch};
const obj=(v:unknown):Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const unavailable=():ReceptionSetupAnalytics=>({status:'unavailable'});
export async function readReceptionSetupAnalytics(env:Env,deps:Deps):Promise<ReceptionSetupAnalytics>{
 if(typeof window!=='undefined'||typeof env.ELEVENLABS_API_KEY!=='string'||!env.ELEVENLABS_API_KEY.length||env.ELEVENLABS_API_KEY.length>4096||!/^[\x21-\x7e]+$/.test(env.ELEVENLABS_API_KEY))return unavailable();
 try{
  const [config,state]=await Promise.all([deps.rpc('icash_get_general_reception_config'),deps.rpc('icash_get_reception_setup')]);
  const c=obj(config),s=obj(state),attempts=obj(s.attempts),attempt=obj(attempts.prepare_branch),at=typeof attempt.started_at==='string'?Date.parse(attempt.started_at):NaN;
  if(c.account_id!==receptionTarget.accountId||c.owner_user_id!==receptionTarget.ownerUserId||c.called_number!==receptionTarget.calledNumber||c.enabled!==false||s.schema_version!==1||Object.keys(attempts).length!==1||attempt.state!=='started'||attempt.finished_at!==null||!Number.isFinite(at)||at<start||at>=end)return unavailable();
  const response=await(deps.fetcher??fetch)(endpoint,{method:'POST',headers:{'xi-api-key':env.ELEVENLABS_API_KEY,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({start_time:start,end_time:end,limit:20,sort:'asc',search:path}),cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(8000)});
  // Includes 403: stop, no retry or alternate endpoint/key/scope.
  if(!response.ok||response.redirected||(response.url&&response.url!==endpoint)){await response.body?.cancel().catch(()=>undefined);return unavailable();}
  if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))return unavailable();
  const data=obj(JSON.parse(await boundedBody(response,128*1024))),columns=data.columns;
  if(!Array.isArray(columns)||!columns.length||columns.length>32||new Set(columns).size!==columns.length||columns.some(c=>typeof c!=='string'||!/^[A-Za-z][A-Za-z0-9_ .-]{0,63}$/.test(c))||!Array.isArray(data.column_types)||data.column_types.length!==columns.length||!Array.isArray(data.column_units)||data.column_units.length!==columns.length||!Array.isArray(data.rows)||data.rows.length>20||data.rows.some(row=>!Array.isArray(row)||row.length!==columns.length))return unavailable();
  const required=['timestamp','method','path','status_code'],indices=required.map(name=>columns.indexOf(name));
  if(indices.some(index=>index<0)||!['DateTime','Int'].includes(String(data.column_types[indices[0]]))||data.column_types[indices[1]]!=='String'||data.column_types[indices[2]]!=='String'||data.column_types[indices[3]]!=='Int'||data.column_units[indices[0]]!=='ms')return {status:'unavailable',schemaColumns:columns as string[]};
  if(data.rows.length===20)return {status:'ambiguous'}; // Potential truncation.
  const matches:number[]=[];
  for(const row of data.rows){
   const [time,method,requestPath,status]=indices.map(index=>row[index]);
   const timestamp=typeof time==='number'&&Number.isSafeInteger(time)?time:NaN;
   if(!Number.isFinite(timestamp)||timestamp<at||timestamp<start||timestamp>=end||typeof method!=='string'||typeof requestPath!=='string'||!Number.isSafeInteger(status)||status<100||status>599)return unavailable();
   if(method==='POST'&&requestPath===path)matches.push(status);
  }
  if(matches.length>1)return {status:'ambiguous'};
  if(matches.length===1)return {status:'matched',httpStatus:matches[0],method:'POST',path};
  return unavailable();
 }catch{return unavailable();}
}
