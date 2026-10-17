/** A cue alone is not exposure: wait until the offer heading is on screen. */
export function observeWebinarOfferView(heading:HTMLElement,onView:()=>void){
 if(typeof IntersectionObserver==='undefined')return()=>{};
 let finished=false;
 const observer=new IntersectionObserver(entries=>{
  if(finished||document.hidden||!entries.some(entry=>entry.target===heading&&entry.isIntersecting&&entry.intersectionRatio>=0.5))return;
  finished=true;cleanup();onView();
 },{threshold:0.5});
 const visible=()=>{
  if(!finished&&!document.hidden){observer.unobserve(heading);observer.observe(heading);}
 };
 function cleanup(){observer.disconnect();document.removeEventListener('visibilitychange',visible);}
 observer.observe(heading);document.addEventListener('visibilitychange',visible);
 return()=>{finished=true;cleanup();};
}
