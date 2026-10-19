// Compatibility for already-open webinar tabs; departure reminders were retired.
export async function POST(){return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});}
