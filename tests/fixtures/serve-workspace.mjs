// Local fixture harness. It intercepts EVERY /api request and never contacts providers.
// Start `npm run dev -- --port 3005`, then `node tests/fixtures/serve-workspace.mjs`.
// Open http://localhost:3006/?fixture=volume (or empty, error, guest).
import http from 'node:http';
import {makeWorkspaceFixture,fixtureAccount,uuid} from './workspace-volume.mjs';
const appPort=Number(process.env.APP_PORT||3005),port=Number(process.env.PORT||3006);
let scenario='volume';let setup={id:uuid(9999),revision:0,stage:0,profile:{displayName:'',theme:'ink',logo:'monogram',voice:'sarah',market:'Nationwide',marketMode:'nationwide',aiLogo:null,contracts:true,buyers:true}};const manualIds=new Set(),handled=new Set();
function json(res,value,status=200){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost:3006');if(url.searchParams.has('fixture'))scenario=url.searchParams.get('fixture');
 if(url.pathname.startsWith('/api/')){
  let raw='';for await(const chunk of req)raw+=chunk;let body={};try{body=JSON.parse(raw||'{}');}catch{}
  if(url.pathname==='/api/setup'){if(body.action==='save')setup={...setup,profile:body.profile,stage:body.stage,revision:setup.revision+1};return json(res,{setup});}
  if(url.pathname==='/api/setup/event')return json(res,{saved:true});
  if(url.pathname==='/api/funding/status')return json(res,{mode:'test',enabled:false,packs:[{code:'budget_ten',price_cents:1000,credit_cents:1000,enabled:false}]});
  if(url.pathname==='/api/billing/daily')return json(res,{ready:false,plan:null});
  if(url.pathname==='/api/account')return json(res,scenario==='guest'?{signedIn:false,signInReady:false}:{...fixtureAccount,...(['zero','reserved'].includes(scenario)?{balanceCents:scenario==='zero'?0:20,reservedCents:65}:{}),paused:scenario!=='running',activeWork:scenario==='running',smsWorkReady:scenario==='running'});
  if(url.pathname==='/api/work/outreach-campaign')return req.method==='GET'?json(res,{policy:{version:'fixture-policy-v1',text:'FICTIONAL QA responsibilities. No recipient permission or real campaign is created.',mode:'sms_inbound'},acknowledgment:{version:'fixture-policy-v1',acceptedAt:'2026-10-01T12:00:00.000Z'},configured:true,released:scenario==='running',liveWorkReady:false,smsChannelEnabled:true}):json(res,{error:'QA only: campaign saves disabled.'},409);
  if(url.pathname==='/api/work/property-photo')return json(res,{photo:null});
  if(url.pathname==='/api/work/activity')return scenario==='error'?json(res,{error:'Fictional QA network failure.'},503):json(res,makeWorkspaceFixture({count:['empty','zero'].includes(scenario)?0:scenario==='paused'?6:48,page:Number(url.searchParams.get('page')||0),attentionPage:Number(url.searchParams.get('attentionPage')||0),query:url.searchParams.get('query')||'',screeningId:url.searchParams.get('screeningId')||'',manualIds:[...manualIds],handled:[...handled]}));
  if(url.pathname==='/api/work/control'){if(body.action==='pause')scenario='paused';else if(body.action==='resume')return json(res,{error:'QA only: starting is disabled.'},409);else body.action==='takeover'?manualIds.add(body.screeningId):manualIds.delete(body.screeningId);return json(res,{saved:true});}
  if(url.pathname==='/api/work/text-attention'){handled.add(body.id);return json(res,{saved:true});}
  if(url.pathname==='/api/work/summary')return scenario==='missing'?json(res,{error:'Synthetic unavailable summary'},503):json(res,{generatedAt:'2026-10-02T20:00:00Z',ownerRecords:0,contracts:0,closed:0,analyzed:['empty','zero'].includes(scenario)?0:48,screeningCandidates:['empty','zero'].includes(scenario)?0:36,activeContracts:0,explanation:'Fictional local QA records, not account results.',spentCents:1750,balanceCents:12500,fundedCents:14250,reservedCents:0,canFund:false,packs:[]});
  if(url.pathname==='/api/work/messages'){
   if(req.method==='POST')return json(res,{error:'QA only: no text was sent.'},409);
   const threads=[{id:uuid(9001),recipient:'+1 (555) 010-0100',party:'seller',paused:true,manualReply:true},{id:uuid(9002),recipient:'+1 (555) 010-0101',party:'buyer',paused:false}];const threadId=url.searchParams.get('threadId')||threads[0].id;
   return json(res,{threads,threadId,ai:[],nextThread:null,next:null,messages:[{id:uuid(9004),thread_id:threadId,direction:'incoming',body:'Could a person walk me through the next step?',state:'received',created_at:'2026-09-30T12:01:00Z'},{id:uuid(9003),thread_id:threadId,direction:'outgoing',body:'This is an example bot message. No offer is agreed and no appointment is booked.',state:'accepted',created_at:'2026-09-30T12:00:00Z'}]});
  }
  if(url.pathname==='/api/work/emails')return json(res,{contacts:[],messages:[],configured:false,rate:null,next:null});
  if(url.pathname==='/api/work/conversation')return json(res,{transcript:[{role:'agent',message:'I’m the AI assistant for Example Company.'},{role:'user',message:'I need more information before deciding.'}],next:null});
  if(url.pathname==='/api/work/showings')return json(res,{showings:[]});
  if(url.pathname==='/api/work/review-status')return json(res,{items:[{key:'contact_permission',title:'Contact permission',status:'review_required',detail:'This fictional fixture has no verified outreach permission.',action:'operator_review'}]});
  return json(res,{error:'This action is disabled in the local QA fixture.'},503);
 }
 const upstream=http.request({hostname:'localhost',port:appPort,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end('Start the local Next.js server on port 3005.');});req.pipe(upstream);
}).listen(port,'127.0.0.1',()=>console.log(`Fictional UI QA only: http://localhost:${port}/?fixture=volume. All API calls are intercepted.`));
