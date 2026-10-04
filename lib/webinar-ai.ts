export async function webinarAI(system:string,prompt:string,maxTokens=500,timeoutMs=15000){
 const model=process.env.ICASH_WEBINAR_AI_MODEL||process.env.ICASH_SUPPORT_AI_MODEL;
 if(!process.env.OPENAI_API_KEY||!model)return null;
 const res=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,max_completion_tokens:maxTokens,messages:[{role:'system',content:system},{role:'user',content:prompt}]})});
 if(!res.ok)return null;const data=await res.json();const text=data.choices?.[0]?.message?.content;
 return data.choices?.[0]?.finish_reason==='stop'&&typeof text==='string'?text.trim().slice(0,Math.min(40000,maxTokens*5)):null;
}
