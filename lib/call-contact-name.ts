/** A greeting only: a saved name never verifies the caller or their authority. */
export function callFirstName(value:unknown):string|null{
 if(typeof value!=='string'||!value.trim()||value.length>200||/[\r\n\x00-\x1f{}<>]/.test(value))return null;
 const name=value.trim();
 if(!/^[\p{L}\p{M}'’ -]+$/u.test(name)||/\b(?:llc|inc|corp|corporation|company|properties|investments|holdings|trust|homes|partners|group)\b/i.test(name))return null;
 const first=name.split(/\s+/)[0];
 if(!/^[\p{L}][\p{L}\p{M}'’-]{0,39}$/u.test(first)||/^(?:unknown|potential|buyer|seller|owner|interested|selling|ready|not|yes|no|test|null|undefined|ignore)$/i.test(first))return null;
 return first===first.toLocaleUpperCase('en-US')?first[0].toLocaleUpperCase('en-US')+first.slice(1).toLocaleLowerCase('en-US'):first;
}
