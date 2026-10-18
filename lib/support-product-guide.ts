import type {SupportEvidence} from './support-policy.ts';

/** Curated from the owner's October 17, 2026 course and the current workspace.
 * Keep the private recording/transcript out of the repository and model input.
 * Current controls and verified checks take precedence over course examples.
 */
export const supportProductGuide = `
iCash X is real-estate deal automation. Customers are using their bot to find and work seller leads, pursue purchase agreements, find cash buyers, and coordinate closing. They are not asking how to market a freelance service. Interpret "get a client" or "get leads" in this iCash X context. Do not suggest networking, referrals, social media marketing, freelance platforms, or ask what service/product they sell as the normal way to get leads.

Getting started: open Course in the workspace and watch the training. The course also has a PDF and a fictional practice workspace. In Settings, save contact email/phone and an individual name or company name for agreements. An LLC is not required to choose Individual. Customize bot includes the bot name. Complete any required workspace acknowledgment yourself. Check software access, work credits, and the bot status. Use Add money when credit is needed, and Run bot to resume an intentionally paused bot. Never claim that support has started it or funded it.

Getting leads: with access, credits, required setup and checks ready, keep the bot running. iCash X automatically looks for eligible seller opportunities and works incoming/assigned leads; customers do not add listings, upload properties, manually find clients, or add a test property to start. If asked "How do I add a listing?", explain that leads come in automatically and appear in Leads; do not invent an Add listing button, listing form, MLS upload, or manual-listing setup step. New leads appear in Leads. "Looking for a deal" with no leads can mean the running bot is waiting for an eligible opportunity, not an error. Watch Leads and notifications while it runs. There is no fixed lead-arrival time, guaranteed lead count per credit amount, guaranteed deal, or guaranteed income. More credits allow more eligible usage; they do not guarantee an outcome. Never tell someone to just wait when verified checks show a pause, missing credit, access problem, or service blocker. Unknown checks are not proof everything is running. Missing purchased credit is checked against the recorded payment automatically; never ask for another payment to replace it.

Monitoring: the workspace shows leads, calls, texts, contracts and notifications. Open a property for its latest update, call recordings/transcripts, and texts. Notifications flag items needing the customer's attention. Take over pauses new automatic work on that property so the customer can handle calls/texts themselves; already-started work may finish. Return to bot resumes eligible automation. The overall Pause bot control stops new work; it does not cancel a subscription or signed contract.

Agreements: the bot can speak/text with eligible sellers and prepare agreements. After a seller signs, the customer reviews the conversation, numbers, owners and actual agreement, then signs if appropriate. Never say the AI guarantees that the numbers work or that review is unnecessary. Documents contains agreement review/signing and available document controls. Contract cancellation is a separate property-document flow, not subscription cancellation; do not give blanket promises of cancellation rights or legal/tax advice.

Buyers and closing: after the required purchase signatures and checks, the bot can prepare a buyer package, find cash buyers and contact buyers by SMS and email. There are no outbound AI calls to buyers. Review buyer replies, viewing availability and the workspace's requested next steps. Follow document, deposit and title-company requests. An offer, signature or promised payment is not a completed closing or money received. Use verified closing/payment status. Do not repeat sample prices, dates, deposits or earnings as requirements or promises.

Sales policy: all sales are final. Do not offer or promise refunds. Troubleshoot access and software issues, and reconcile verified payment errors. Cancellation of future renewals is separate and uses the existing confirmation flow.

Plans: Standard includes ordinary automated bot work and bot-name customization. VIP includes Ask AI Bot about the workspace/properties, buyer-network access, lead priority, custom voice and eligible usage savings. Automated support chat is available without VIP, including help getting into an account. Do not require a VIP upgrade to get ordinary bot leads or support. Use current verified plan/pricing details; do not invent a plan, price, discount or entitlement from the conversation.

Course viewing: use the verified course check to see recorded playback for the current video. course_unrecorded means no playback is recorded, not proof they never watched; earlier or offline viewing can be missing. For setup/how-to questions, tell them to watch Course. course_in_progress means they should finish it; use only the recorded percentage. course_completed means at least 95% was played, so acknowledge that and point to a relevant section if needed. Unknown progress is not unviewed. Never withhold help or mark an actual problem resolved just because the course is unfinished.

Stay with the customer's current step. If they already watched the course, do not tell them to watch it again as the solution. Ask one useful missing question such as the exact bot status or where they are stuck. If product knowledge cannot answer the question, say what is unknown and ask for relevant details and keep troubleshooting in the same conversation; do not invent features or substitute general business coaching.
`.trim();

type Turn={role:string;content:string};
type CourseTopic='leads'|'start'|'course';
function courseTopic(question:string):CourseTopic|null{
 if(/\b(?:billing|charged|refund|cancel|password|sign.?in|log.?in|code|card)\b/i.test(question))return null;
 if(/\b(?:add|adding|upload|uploading|create|creating|post|posting|import|importing|enter|entering)\b.{0,50}\b(?:listing|listings|property|properties|lead|leads)\b|\b(?:listing|listings)\b.{0,35}\b(?:add|upload|create|post|import|enter)\b/i.test(question)&&!/\b(?:buyer|buyers|contract|delete|remove|archive|duplicate|call|text|email|reply|message)\b/i.test(question))return 'leads';
 if(/\b(?:lead|leads|client|clients|customer|customers)\b/i.test(question)&&/\b(?:get|getting|find|finding|generate|generating|come|comes|coming|arrive|arriving|wait|waiting|first|new|no|zero|none|where|when|need|buy)\b/i.test(question)&&!/\b(?:buyer|buyers|contract|delete|remove|archive|duplicate|view|open|edit|recording|transcript|call|text|email|reply|respond|message)\b/i.test(question))return 'leads';
 if(/\b(?:get started|where do i start|new here|first steps|set up (?:my|the) bot)\b|\b(?:how (?:do|can|should) i|how to) (?:start|use) (?:icash\s*x|icashx|(?:my |the |this )?(?:software|app|platform|bot))\b|\bhow (?:do|can|should) i start[.!?\s]*$/i.test(question))return 'start';
 if(/\b(?:where|find|open|watch|access)\b.{0,40}\b(?:course|training|tutorial|lesson|video|pdf|practice workspace)\b/i.test(question)&&!/(?:can.t|cannot|won.t|not|error|stuck|fail)/i.test(question))return 'course';
 return null;
}

/** Core onboarding answers are local so outages/replays cannot turn them into generic sales advice. */
export function supportCourseAnswer(messages:Turn[],evidence:SupportEvidence[]=[]):{reply:string;needsRecovery:boolean;answered:boolean}|null{
 const users=messages.filter(m=>m.role==='user'),question=users.at(-1)?.content??'';
 let topic=courseTopic(question);
 if(!topic&&/^(?:i(?:'ve| have)? )?(?:already (?:watched|finished)|watched|finished|it(?:'s| is) running|my bot is running|i have credits|done|now what|what next|how long|still waiting)\b/i.test(question)&&users.slice(0,-1).some(m=>['leads','start'].includes(courseTopic(m.content)??'')))topic='leads';
 if(!topic)return null;
 if(topic==='course')return {reply:'Open Course in your workspace to watch the training video. The PDF download and practice workspace are there too, so you can follow the steps and explore sample deals. If it won’t open, tell us what you see on the screen.',needsRecovery:false,answered:true};
 const viewing=evidence.find(e=>e.key==='course');
 const watched=viewing?.code==='course_completed'||messages.some((m,index)=>m.role==='user'&&!/(?:not|haven.t|didn.t|never)\b/i.test(m.content)&&(/\b(?:watched|finished|completed)\b.{0,35}\b(?:course|training|video)\b|\b(?:course|training|video)\b.{0,25}\b(?:done|finished|completed)\b/i.test(m.content)||/^(?:i(?:'ve| have)? )?(?:already )?(?:watched|finished|completed) (?:it|that)[.!?\s]*$/i.test(m.content)&&messages.slice(0,index).some(turn=>turn.role==='assistant'&&/\b(?:course|training|video)\b/i.test(turn.content))));
 const courseStep=watched?'With the course finished, check that your contact information and individual or company name are saved in Settings.':viewing?.code==='course_in_progress'?'Your course viewing is still in progress. Finish the Course in your workspace, including the Settings steps.':viewing?.code==='course_unrecorded'?'I don’t see playback recorded for the current course yet; earlier viewing may not be recorded. Watch the Course in your workspace and complete its Settings steps.':'Watch the Course in your workspace and finish the Settings steps for your contact information and individual or company name.';
 const intro=topic==='start'?courseStep:'You don’t need to add listings or upload properties. In iCash X, your bot finds and works eligible seller leads automatically, and incoming leads appear in Leads.';
 const course=topic==='leads'&&!watched?' '+courseStep:'';
 const check=(key:string)=>evidence.find(e=>e.key===key);
 const payment=check('payments'),readiness=check('readiness'),work=check('work'),credits=check('credits'),subscription=check('subscription');
 let next:string,needsRecovery=false,answered=false;
 if(payment?.status==='attention'&&payment.code==='payment_uncredited'){
  next='Your checks show a recorded payment has not been added to your credits yet. The latest recovery check has not confirmed the credit yet; do not pay again.';needsRecovery=true;
 }else if(readiness?.status==='attention'){
  next='Your service checks show something needs attention before eligible work can run. Describe the failed step here; adding credits will not clear that service issue.';needsRecovery=true;
 }else if(subscription?.status==='attention'){
  next='Your software access needs attention. Open your subscription settings to review the status, and tell us what message appears.';
 }else if(payment?.status==='attention'&&payment.code==='checkout_pending'){
  next='A checkout is still pending. Return from checkout and refresh the status before paying again; tell us if it does not update.';
 }else if(work?.status==='attention'&&work.code==='paused'){
  next='Your bot is currently paused. Review the pause in your workspace, check your credits, and choose Run bot when you want it to resume. If you did not pause it, tell us before resuming.';
 }else if(credits?.status==='attention'&&credits.code==='no_available_credit'){
  next='Your bot has no available work credits. Review Credits left and use Add money if you want more eligible work to run; if you already paid and the credit is missing, tell us before paying again.';
 }else if(work?.status==='ok'&&credits?.status==='ok'&&readiness?.status==='ok'){
  next='Your checks show the bot is not paused, credit is available, and service readiness passed. Keep it running and watch Leads and notifications for incoming leads and the next step for each deal. “Looking for a deal” can mean it is waiting for an eligible opportunity; there is no fixed arrival time.';
  answered=true;
 }else{
  next='Once setup, access and credits are ready, keep the bot running; new leads appear in Leads and notifications show the next step for each deal. I can’t confirm that all your bot checks are ready here. What status does your bot show right now?';
 }
 return {reply:`${intro}${course}\n\n${next}`,needsRecovery,answered};
}
