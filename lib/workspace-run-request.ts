// A checkout return may start work only after this account explicitly clicked Start bot.
const key='icash:run-request';
const lifetime=60*60*1000;
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function saveRunRequest(storage:StorageLike,email?:string,now=Date.now()){
 if(!email)throw Error('Sign in again before starting your bot.');
 storage.setItem(key,JSON.stringify({email,createdAt:now}));
}
export function clearRunRequest(storage:StorageLike){try{storage.removeItem(key);}catch{/* Storage must never prevent stopping work. */}}
export function hasRunRequest(storage:StorageLike,email?:string,now=Date.now()){
 try{const request=JSON.parse(storage.getItem(key)||'null');return !!email&&request?.email===email&&typeof request.createdAt==='number'&&Number.isFinite(request.createdAt)&&request.createdAt<=now&&now-request.createdAt<lifetime;}catch{return false;}
}
export function consumeRunRequest(storage:StorageLike,email?:string,now=Date.now()){
 const valid=hasRunRequest(storage,email,now);clearRunRequest(storage);return valid;
}
