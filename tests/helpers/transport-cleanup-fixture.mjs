import assert from 'node:assert/strict';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
/** Offline response with an independent cleanup outcome. Open responses use
 * native cancellation; complete receipts retain native reads and replace only
 * cancellation so cleanup failure cannot be mistaken for missing evidence. */
export function transportCleanupFixture({mode,body='',size,status=200,headers={}}){
 let cancellations=0,rejectCleanup;
 const pending=new Promise((_,reject)=>{rejectCleanup=reject;});
 const cancel=()=>{
  cancellations++;
  if(mode==='synchronous')throw Error('private cleanup failure');
  return mode==='rejected'?Promise.reject(Error('private cleanup failure')):pending;
 };
 const response=size===undefined?new Response(body,{status,headers}):new Response(new ReadableStream({
  start(controller){controller.enqueue(new Uint8Array(size));},cancel,
 }),{status,headers});
 if(size===undefined||mode==='synchronous'){
  const getReader=response.body.getReader.bind(response.body);
  response.body.getReader=()=>{const reader=getReader();reader.cancel=cancel;return reader;};
  response.body.cancel=cancel;
 }
 return {response,cancellations:()=>cancellations,finish(){if(mode==='pending'&&cancellations)rejectCleanup(Error('private late cleanup failure'));}};
}

export async function settleBeforeCleanup(work,fixture){
 let outcome,settled=false;
 const pending=work.then(value=>({value}),error=>({error})).then(result=>{outcome=result;settled=true;});
 try{
  for(let turn=0;turn<20&&!settled;turn++)await flush();
  assert.equal(settled,true,'Known read outcome must not wait for transport cleanup');
  assert.equal(fixture.cancellations(),1,'Cleanup starts once');
  assert.equal(fixture.response.body.locked,false,'The bounded reader releases its lock');
  return outcome;
 }finally{fixture.finish();await pending;await flush();}
}
