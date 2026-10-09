/** Shared by authenticated SMS ingestion and analysis. Explicit withdrawal wins
 * over a callback in the same message; ordinary uses such as "stop by" do not. */
export function isContactOptOut(body:string){
 const text=body.replace(/[’‘]/g,"'").trim();
 return /^(?:please\s+)?(?:stop|stopall|unsubscribe|cancel|end|quit|revoke|opt\s*out)(?:\s+please)?(?:[.!\s]*$|\s*[,;.!]\s*(?:please\b|call\b|text\b|but\b))/i.test(text)
  || /^(?:please\s+)?(?:unsubscribe|remove|delete)\s+(?:me|my number)[.!\s]*$/i.test(text)
  || /\b(?:do not|don't|dont|stop)\s+(?:texting|messaging|contacting|calling|text|message|contact|call)(?:\s+(?:me|us))?\b(?!\s+(?:it|that|the house|the property)\b)/i.test(text)
  || /\b(?:remove|take)\s+(?:me|my number)\s+(?:off|from)\b|\bleave\s+(?:me|us)\s+alone\b/i.test(text);
}
export function asksForCallback(body:string){
 return !isContactOptOut(body)&&/\b(?:call me|call back|callback|can you call|could you call|call tomorrow|call today)\b/i.test(body)
  && !/\b(?:do not|don't|dont|cannot|can't|no)\s+(?:call|callback)\b/i.test(body);
}
