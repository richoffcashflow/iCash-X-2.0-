"""Build a synthetic design catalog. This is not a live-outcome or test report."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GROUPS = []

def group(name, lane, paths, surface, gap, next_step, rows, source='R1'):
    cases=[]
    for line in rows.strip().splitlines():
        mode, event, action, evidence = line.split('|')
        cases.append(dict(mode=mode,event=event,action=action,evidence=evidence))
    assert len(cases)==10, (name,len(cases))
    GROUPS.append(dict(name=name,lane=lane,paths=paths.split(','),surface=surface,gap=gap,next_step=next_step,cases=cases,source=source))

group('Seller identity and property', 'Seller', 'lib/seller-text-offer.ts,lib/call-offer-evidence.ts', 'Seller conversation', 'G01', 'Continue the next unanswered qualification item.', '''
Q|Yes, I own that house.|Save ownership as an answer to the actual ownership question; separately establish sale interest.|Delivered question and property-bound reply
Q|Yes, I would sell.|Save sale interest without treating it as proof of ownership.|Exact selling-interest question
Q|You have the wrong house.|Ask which address they mean without disclosing another property.|Bound current address and their correction
S|Wrong number; I do not own it.|Stop that recipient-property route and cancel unsent follow-ups.|Original wrong-number statement
Q|That is my rental, not my home.|Retain the property and record tenant occupancy.|Confirmed address and occupancy statement
Q|I sold that property last year.|Stop new seller outreach for this ownership source; refresh records before reassignment.|Sale statement and new ownership evidence
Q|I own several houses on that street.|Ask for the exact house number before discussing terms.|Unambiguous address
Q|The owner is my spouse.|Collect the actual decision-maker route without assuming signing authority.|Owner identity and permission to contact
Q|My LLC owns it.|Collect the entity name and authorized signer evidence.|Entity ownership and signer authority
Q|I am calling back from another phone.|Match the original deal using verified context before disclosing private terms.|Exact prior contact and property binding
''')
group('Refusals and contact preferences','Seller','lib/seller-response-policy.ts,config/seller-response-policy.sql','Seller conversation','G01','End only the refused path, or resume through a newly permitted channel.','''
S|Stop texting me.|Suppress texts immediately and cancel unsent text work.|Exact opt-out source
S|Do not contact me again.|Suppress further outreach to that recipient across applicable channels.|Exact all-contact refusal
S|No, I am not selling.|End the selling pitch and cancel its pending follow-ups.|Sale-refusal context
Q|No, I am not the owner.|End owner qualification; do not ask why the seller called.|Ownership question and negative answer
Q|No agents, please.|Explain the actual contract-holder role and ask if assignment is acceptable.|Delivered role explanation and response
Q|No wholesalers or assignments.|Respect the restriction; do not market an assignment against it.|Explicit assignment refusal
Q|Do not call; text only.|Disable calls for this contact and continue permitted texts.|Current text-only preference
Q|I cannot talk right now.|Ask for a callback time once without treating this as permanent refusal.|Requested time and recipient timezone
Q|Not this month; try January.|Record an explicit future follow-up date instead of repeated near-term calls.|Exact requested month and clarified date
P|I want a person.|Record the handoff, stop automated negotiation, and expose the specific request.|Human request and assigned responder
''')
group('Trust and process objections','Seller','config/seller-dialogue.sql,lib/text-ai-policy.ts','Seller conversation','G02','Answer the objection, then ask one missing qualification question.','''
Q|Is this a scam?|Explain the real principal, process, and verification path without invented reviews.|Verified business identity
Q|Are you a robot?|Disclose AI assistance plainly.|Actual system role
Q|Where did you get my number?|Give the recorded source explanation without inventing consent.|Source provenance
Q|Are you the actual buyer?|Explain contract-holder and assignment roles accurately.|Current transaction role
Q|Will you list my house?|Describe only the authorized transaction and marketing arrangement.|Actual agreement and authority
Q|Do I pay a commission?|Explain the saved fee and cost terms without promising universal zero fees.|Current cost allocation
Q|Do I have to clean it out?|Ask which belongings remain and record the proposed arrangement.|Personal-property and possession terms
Q|Can you show proof you can close?|Request or share authorized proof through a verified route; do not fabricate funds.|Verified proof-of-funds document
Q|Why should I sign online?|Explain the existing signing process and offer its supported access options.|Actual signing provider workflow
Q|I had a buyer disappear before.|Explain milestones and the actual deadline; do not guarantee completion.|Current contract deadlines and next action
''','R2')
group('Seller motivation and timing','Seller','lib/seller-text-offer.ts,config/seller-dialogue.sql','Seller conversation','G02','Translate the seller goal into proposed dates and factual requirements.','''
Q|I need to close in seven days.|Check title, signatures, and funding feasibility before proposing that date.|Title readiness and party availability
Q|I need sixty days to move.|Record the requested closing or possession period separately.|Closing date and possession date
Q|I need to find another house first.|Clarify the dependency and a check-in date without promising relocation money.|Seller contingency and desired check-in
Q|I inherited it and want it gone.|Collect estate and signer facts before any binding commitment.|Estate ownership and authority
Q|I am relocating for work.|Ask the target move date and occupancy needs.|Move date and access availability
Q|I am tired of being a landlord.|Collect lease and tenant access facts.|Lease, deposits, occupancy
Q|I need cash for another purchase.|Clarify required net proceeds without promising a net amount.|Payoffs and itemized seller costs
Q|The property is sitting vacant.|Record vacancy and request safe access information.|Vacancy evidence and access permission
Q|I might sell if the price is right.|Ask the price expectation; calculate only from current underwriting.|Asking price and property inputs
Q|I am comparing several offers.|Ask which terms matter and present supported price/date terms.|Actual competing terms if volunteered
''')
group('Seller price objections','Seller','lib/seller-text-offer.ts,lib/automatic-call-offer.ts','Offer and seller conversation','G03','Deliver a supported counteroffer or clarify the price, then await explicit acceptance.','''
A|Your offer is too low.|Give the supported counteroffer and explain relevant repairs and as-is tradeoffs.|Current ARV, repairs, fee and quoted version
Q|Zillow says it is worth more.|Explain the difference between an estimate and the supported cash offer.|Current valuation evidence
Q|My neighbor sold for much more.|Ask for the comparable and compare condition, date, size and location.|Comparable transaction details
Q|I need this amount in my pocket.|Distinguish net proceeds from purchase price and obtain payoffs.|Payoff and closing-cost evidence
A|I will take less than your offer.|Recalculate within current rules and explicitly confirm the changed price.|Fresh seller ask and offer version
Q|Another buyer offered more.|Ask which verified terms differ without making an unsupported price match.|Actual competing price and contingencies
Q|I already spent a lot on renovations.|Collect the work and supporting condition evidence before recalculation.|Renovation scope and current inspection facts
Q|Raise the price and I will sign now.|Re-underwrite within delegated limits; retain the accepted version until changed.|Current maximum and new acceptance
Q|Does that price include everything?|Explain purchase price, allocated costs and unresolved payoff amounts.|Exact current terms
Q|I said one-fifty, not fifty.|Clarify the dollar amount before saving or quoting a revised price.|Unambiguous amount and currency
''')
group('Condition and repair discovery','Inspection','lib/seller-text-offer.ts,lib/equity-screen.ts','Property details and conversation','G04','Obtain evidence, update underwriting prospectively, and preserve already accepted terms.','''
Q|The roof leaks.|Ask age, leak location and available photos; avoid inventing repair cost.|Roof condition evidence
Q|There are foundation cracks.|Request an inspection or engineer report and access availability.|Foundation report or observed condition
Q|The air conditioner does not work.|Collect system age and repair diagnosis.|HVAC facts and estimate
Q|The house flooded last year.|Collect flood history and remediation documentation.|Flood and repair records
Q|There was a fire.|Collect affected areas, permits and repair evidence.|Fire damage and restoration records
Q|There may be mold.|Record the concern and request qualified inspection evidence.|Mold assessment and access consent
Q|The plumbing keeps backing up.|Collect symptoms and any sewer inspection report.|Plumbing evidence
Q|The addition was built without permits.|Request permit history and route the specific issue to title or local expertise.|Permit and zoning records
Q|It is fully renovated.|Request dated photos and scope before reducing repair assumptions.|Renovation evidence
Q|I do not know what repairs it needs.|Request photos or a permitted inspection rather than treating repairs as zero.|Condition evidence or inspection appointment
''','R4')
group('Underwriting and data conflicts','Offer','lib/automatic-call-offer.ts,lib/equity-screen.ts','Offer and property details','G03','Resolve the specific input and recompute a versioned offer.','''
Q|ARV is missing.|Obtain permitted comparable evidence before quoting a price.|Current ARV evidence
Q|Repair estimate is missing.|Request property facts and a bounded estimate; do not substitute zero.|Repair estimate source
Q|Equity records conflict.|Reconcile loan and ownership evidence before purchase commitment.|Current debt evidence
Q|Two valuations disagree materially.|Compare source dates and comparable quality; retain uncertainty.|Versioned valuations
Q|A new lien appears after the offer.|Recalculate the seller net and route payoff requirements.|Recorded lien and payoff amount
Q|The property is a duplex, not a house.|Re-evaluate product and buyer-fit eligibility.|Verified property type
Q|The address resolves to two parcels.|Clarify the legal parcel being sold.|Parcel and legal description
Q|Buyer demand does not support the price.|Re-evaluate marketable terms within the approved margin floor.|Buyer demand and current ask
Q|Recent sale data is stale.|Refresh an authorized source or label uncertainty before quoting.|Observation dates
Q|Repair plus fee eliminates the margin.|Stop unsupported commitments and explain the specific economics.|Current calculation inputs
''')
group('Outbound call outcomes','Calls','lib/recorded-outbound-readiness.ts,lib/call-offer-evidence.ts','Call history and recording','G01','Record the real result and schedule only the next eligible seller action.','''
A|Seller does not answer.|Apply the existing bounded unanswered sequence and contact window.|Original terminal unanswered receipt
A|Call reaches voicemail.|End promptly without leaving a message; use permitted follow-up rules.|Confirmed voicemail result
A|Line is busy.|Schedule the permitted later attempt without resetting prior attempts.|Terminal busy receipt
Q|Seller answers but cannot hear.|End safely and offer a permitted alternative after the call settles.|Completed call and channel preference
Q|Call drops during price discussion.|Recover the saved offer state and ask only the missing confirmation.|Terminal call and exact last terms
Q|Seller answers on speakerphone.|Confirm who is participating before sharing private details.|Participant roles
Q|Seller speaks Spanish.|Use a verified supported language path; preserve amounts and consent.|Language support and preference
S|Seller says no and hangs up.|Persist refusal and cancel pending pitch calls or texts.|Source-backed refusal
Q|A receptionist answers.|Ask for the permitted owner route without disclosing sensitive deal facts.|Role and contact authority
Q|A carrier announcement answers.|Classify machine failure separately from seller intent.|Carrier status and recording evidence
''')
group('Inbound calls and context','Calls','lib/buyer-reception-context.ts,lib/buyer-response-policy.ts','Call history and property thread','G05','Route to the correct existing conversation and create a source-bound next action.','''
Q|Seller returns the missed call.|Reuse the actual property and last question from prior receipts.|Exact account and prior call route
Q|Buyer calls about the package.|Load current public buyer terms without seller acquisition pricing.|Valid package and confirmed property
Q|Caller has two active properties.|Ask which property before discussing terms.|Unique property selection
Q|Caller phone matches two accounts.|Clarify through an authorized route; never guess a tenant.|Account binding
Q|Seller asks whether contract was sent.|Read the original envelope and delivery receipt.|Exact envelope and message status
Q|Buyer asks for photos during a call.|Record an actionable package request for an existing permitted delivery worker.|Buyer identity and authorized package
Q|Buyer says send the assignment.|Collect missing signer details and start only the approved assignment workflow.|Buyer request and signing authority
Q|Title calls with a file update.|Collect reference and route it for verified closer confirmation.|Verified closing contact
Q|A stranger asks about a seller debt.|Decline private disclosure and request an authorized role.|Caller authority
Q|Caller changes from buyer to seller.|Clarify role and property before selecting another workflow.|New verified role binding
''')
group('Texts and conversation continuity','Texts','lib/text-ai-policy.ts,config/seller-dialogue.sql','Text thread','G02','Answer all supported intent parts and ask only the next missing fact.','''
Q|Seller answers three questions at once.|Save each exact supported fact and skip already answered questions.|Incoming source and question history
Q|Seller says yes after an either-or question.|Ask which option they mean.|Exact delivered question
Q|Seller sends only a photo.|Attach it to the correct property and request any missing context.|Verified media source
Q|Seller corrects an earlier answer.|Supersede the earlier fact and reassess affected terms.|Newer explicit correction
Q|Seller asks price and closing date together.|Answer supported terms and collect only the unknown item.|Current offer and date evidence
Q|Reply arrives before the send receipt.|Reconcile the original question before interpreting the reply.|Original delivery evidence
Q|Reply arrives after manual takeover.|Keep it visible and preserve the human-controlled conversation.|Current property controls
Q|Two texts arrive out of order.|Order by trusted source time and avoid acting on a superseded message.|Provider event ordering
Q|A short reply contains a typo.|Clarify only when the typo changes identity, price, date or intent.|Unambiguous source meaning
S|An opt-out arrives while a reply is queued.|Cancel unsent work at final admission immediately.|Latest recipient preference
''')
group('Offer acceptance and changed terms','Contracts','lib/seller-text-offer.ts,lib/signing-policy.ts','Offer and contracts','G03','Obtain acceptance of one exact terms version before preparing its agreement.','''
Q|That price works.|Bind acceptance to the actual delivered proposal.|Delivered amount and matching reply
Q|Yes, but close earlier.|Treat the new date as a counterproposal and confirm the complete changed terms.|New date and explicit acceptance
Q|Yes, if you waive inspection.|Record the condition and use an authorized terms path.|Inspection term and acceptance
Q|I accept the old price.|Clarify which version remains available without silently changing it.|Offer version history
Q|My spouse has to approve.|Collect the additional decision maker before commitment.|Required owners and signer consent
Q|Send me something to look at.|Distinguish document review from agreement acceptance.|Actual request scope
Q|I changed my mind before signing.|Stop unsigned commitment work and preserve the withdrawal.|Latest withdrawal source
Q|I want appliances excluded.|Record personal-property exclusions and confirm the revised document.|Exact exclusion list
Q|I need rent-back after closing.|Collect proposed possession terms for an approved addendum path.|Rent-back terms and party approval
Q|I agree by phone but not by text.|Use permitted signing delivery; do not invent text permission.|Channel permission and spoken acceptance
''','R4')
group('Purchase contract preparation','Contracts','lib/signing-service.ts,lib/signing-policy.ts','Contracts','G06','Prepare one correctly bound document and send it through the authorized channel.','''
Q|Seller legal name is missing.|Ask for the legal name once.|Legal name tied to owner
Q|Two owners must sign.|Collect both signers and use a supported multi-signer template.|Ownership and signer list
Q|The legal description is incomplete.|Request the verified parcel description before final execution.|Legal description
Q|The state-specific template is unavailable.|Select an approved applicable template or obtain the missing professional input.|Jurisdiction and approved template
Q|The contract has a misspelled name.|Correct the unsigned draft or use a formal correction workflow after execution.|Signer identity and document state
Q|The contract lists the wrong address.|Stop delivery and bind the correct property before preparing a replacement.|Verified property and original envelope state
Q|Seller wants a different close date.|Compare contractual deadlines and obtain agreement to the change.|Changed date and required signatures
Q|Seller asks who pays closing costs.|Explain the exact current cost clauses.|Approved document version
Q|Seller refuses an assignment clause.|Explain the clause and honor their restriction; do not remove it informally.|Seller restriction and available approved terms
Q|A new document revision appears during send.|Reject the stale claim and reconcile the exact original envelope.|Claimed document hash and revision
''','R3')
group('Signing delivery and completion','Contracts','lib/signing-service.ts,lib/signing-service.ts','Contracts and text thread','G06','Reconcile the original envelope and collect only the remaining signature.','''
A|Signing link is requested again.|Return the existing valid link through one eligible message operation.|Current envelope and authorized recipient
Q|Seller cannot open the link.|Identify the access failure and use supported recovery without duplicating envelopes.|Original envelope state
Q|Seller says I signed.|Fetch the provider signature receipt; do not accept the assertion as completion.|Canonical signature receipt
Q|Only one owner signed.|Request the missing required signature.|Signer order and completed receipts
P|The customer signature is required.|Present the exact agreement for the customer to sign.|Actual signature authority
Q|An envelope expired.|Determine whether a fresh envelope is authorized after reconciling the old one.|Terminal expiry and unchanged terms
Q|Webhook says complete but signer evidence is absent.|Retrieve original ordered signer evidence before advancing.|Signature audit trail
Q|The same completion webhook arrives twice.|Apply the original milestone once.|Stable provider event and envelope identity
Q|Seller signs after a cancellation request.|Preserve both events and resolve the specific legal state before marketing.|Cancellation and signature timestamps
Q|Signature provider times out after creation.|Reconcile the original request; never create a second envelope blindly.|Original request ID and provider result
''')
group('Contract deadlines and amendments','Contracts','config/title-tasks.sql,config/closing-coordination.sql','Closing tasks and contracts','G07','Track the actual signed deadline and obtain a valid amendment or timely authorized notice.','''
Q|Inspection period ends tomorrow.|Prioritize inspection evidence and the actual contractual options.|Signed deadline and applicable timezone
Q|Earnest money is due today.|Request verified escrow instructions and payment status.|Contract deposit deadline
Q|Closing date falls on a holiday.|Ask title to confirm the contractual treatment; do not shift the date silently.|Signed date and governing terms
Q|Seller requests a week extension.|Prepare the approved extension path and collect all required consent.|Proposed date and signatures
Q|Buyer requests an extension after expiry.|Identify the current contract state before making commitments.|Expiry and extension evidence
Q|A text says extension approved.|Distinguish a conversation from a valid executed amendment.|Required amendment evidence
Q|Two amendments conflict.|Determine the operative version through the authorized parties.|Execution order and document versions
Q|Notice deadline uses a different timezone.|Calculate from the contract timezone and display AM/PM clearly.|Contract timezone and deadline definition
Q|A document contains an impossible date.|Clarify and correct through the appropriate document process.|Valid date and required consent
P|Termination notice may be needed.|Assemble facts and the deadline for the authorized decision maker.|Contract rights and notice requirements
''','R4')
group('Ownership, estate and authority','Title','config/closing-coordination.sql,lib/title-service.ts','Closing tasks','G08','Request specific authority documents and track the closer or attorney response.','''
P|The recorded owner has died.|Obtain estate authority requirements from the verified closer.|Death and estate documents
P|One heir cannot be located.|Track the heirship issue and qualified resolution path.|Required heirs and title findings
P|An executor has not been appointed.|Request the court-authority requirement; do not accept an unappointed signer.|Appointment evidence
P|Power of attorney is offered.|Submit it through the verified closing process for acceptance.|Current valid power and identity
P|Divorcing spouses disagree.|Identify required signatures and unresolved court orders.|Ownership and court restrictions
P|Property belongs to a trust.|Collect trustee authority and applicable trust certification.|Trust and trustee evidence
P|An LLC signer is not listed.|Request entity authority documentation.|Company documents and authorized signer
P|Owner name differs from identification.|Ask the closer for accepted name-correction evidence.|Identity and title chain
P|A minor has an ownership interest.|Route the specific court-authority issue to qualified counsel.|Guardianship or court approval
P|Seller disputes the recorded ownership.|Preserve the dispute and request an authoritative title determination.|Title records and dispute evidence
''','R5')
group('Occupancy and possession','Showings','config/turnkey-deal-journey.sql,config/buyer-call-package-showings.sql','Coordination and property details','G09','Confirm occupancy, lawful access and possession terms before scheduling or promising vacancy.','''
Q|A tenant is on a fixed lease.|Collect the lease and expiration before representing possession.|Lease and tenant rights
Q|Tenant refuses entry.|Request a lawful access plan through the owner or authorized manager.|Access authority and notice requirements
Q|Seller will stay after closing.|Collect a possession proposal and required approved agreement.|Written occupancy terms
Q|The house is occupied by relatives.|Identify occupants and the agreed possession plan.|Occupancy facts
Q|Seller says it is vacant but photos show belongings.|Clarify occupancy and property removal.|Current occupancy evidence
Q|Keys are with a property manager.|Obtain an authorized access route.|Manager authority and contact preference
Q|There is a squatter claim.|Record the issue for qualified resolution; do not promise removal.|Occupancy and legal findings
Q|Security deposit transfers to buyer.|Request the lease ledger and settlement allocation.|Deposit ledger and signed terms
Q|Tenant wants to purchase the house.|Capture the request and check existing contractual obligations.|Tenant request and current contract
Q|Seller needs moving assistance.|Clarify the request and authorized funding rather than promising payment.|Specific assistance and authorized payer
''','R4')
group('Buyer sourcing and fit','Buyers','lib/buyer-discovery-service.ts,lib/buyer-engine.ts','Buyer activity','G10','Match current permitted buyers to the actual package and widen only within approved criteria.','''
A|No buyer matches the first search.|Try another approved search tier using existing scope and budget.|Current search results and allowed scope
A|The same buyer appears twice.|Deduplicate by verified entity and contact identity.|Canonical buyer identity
Q|Buyer budget is below asking price.|Filter or clarify budget without disclosing the acquisition price.|Current buy box and published ask
Q|Buyer only buys a different property type.|Exclude this match and retain their actual preferences.|Verified property type and preferences
Q|Buyer no longer buys in this ZIP.|Update preferences prospectively and stop mismatched outreach.|Current explicit preference
Q|Buyer says they purchase ten homes monthly.|Record stated capacity separately from proven funding or closings.|Buyer statement and verification source
Q|Contact data is stale.|Refresh permitted contact evidence before outreach.|Source date and channel permission
Q|All eligible buyers are already contacted.|Wait for due follow-ups or widen approved sourcing without duplicate messages.|Recipient history and search authorization
Q|A buyer is already reserved for another deal.|Check actual available capacity before ranking.|Current obligations and availability
Q|An investor requests future opportunities.|Use explicit enrollment and saved preferences.|Verified enrollment and opt-in
''')
group('Buyer package questions','Buyers','config/buyer-request-actions.sql,config/buyer-factual-text-replies.sql','Buyer text thread and package','G11','Send the current authorized package or answer the specific supported fact.','''
A|Send photos and property details.|Recognize both as one package request and send one current package link.|Current package authority and incoming source
A|Can I see pictures, information and price?|Use the current package for these same-purpose information requests.|Current published package
Q|What is the asking price?|Quote the current published buyer price only.|Published buyer terms
Q|Where is the property?|Provide only the authorized package address.|Authorized public property details
Q|Do you have interior pictures?|State actual photo availability and request missing photos if permitted.|Actual photo inventory
Q|What repairs does it need?|Share supported condition facts and labeled estimates.|Current condition sources
Q|How was ARV calculated?|Explain the permitted comparable basis without guaranteeing value.|Authorized valuation evidence
Q|Is the house still available?|Read current reservation and contract state before answering.|Current deal state
Q|Can you send comps and photos?|Provide available approved material; identify anything absent.|Authorized package contents
Q|The package link no longer works.|Recover a valid current link without changing another buyer capability.|Original link and current authority
''')
group('Buyer price and commercial objections','Buyers','config/buyer-factual-text-replies.sql,lib/buyer-assignment-pricing.ts','Buyer conversation','G12','Answer within published terms or obtain a narrowly defined new commercial decision.','''
Q|Your price is too high.|Restate the current supported price and ask for the buyer's specific offer.|Published price and buyer counteroffer
Q|What is your assignment fee?|Keep private acquisition information out of conversation; follow actual disclosure obligations.|Approved public terms and required disclosures
Q|Does the deposit add to the price?|Explain how the actual agreement credits the deposit.|Signed deposit clause
Q|Will you cover closing costs?|Explain the saved cost allocation and capture any requested change.|Current agreement
Q|I will buy if you reduce the price.|Capture the exact counteroffer and evaluate only under delegated price limits.|Current margin floor and delegated authority
Q|The repair budget is higher than you estimated.|Collect the buyer's evidence and re-underwrite prospectively.|Repair report and published terms
Q|Another wholesaler is selling it cheaper.|Verify the advertised interest and source before reacting.|Competing package and contract authority
Q|I want an inspection contingency.|Collect requested terms and use the approved agreement process.|Contingency and deadline
Q|I need financing rather than cash.|Clarify funding readiness and whether current terms support it.|Funding plan and contract terms
Q|I want to partner instead of assign.|Capture the proposal without substituting an unauthorized transaction structure.|Specific partnership terms and authority
''','R1')
group('Buyer qualification and selection','Buyers','lib/buyer-qualification.ts,lib/buyer-engine.ts','Buyer qualification and coordination','G12','Collect missing evidence and select only a qualified authorized buyer.','''
Q|Buyer sends proof of funds.|Verify source, date, ownership and amount through the approved process.|Authentic current funds evidence
Q|Proof of funds is expired.|Request a current document.|Verification freshness
Q|Funds belong to a different company.|Clarify the relationship and signing authority.|Entity and funding authority
Q|Buyer will use a hard-money lender.|Collect lender readiness and relevant deadlines.|Actual financing evidence
Q|Buyer will not give legal name.|Explain the missing signing requirement without inventing it.|Legal identity
Q|Two buyers want the deal.|Compare readiness under the actual selection policy before reservation.|Independent qualification and reservation state
Q|Buyer has repeatedly failed to deposit.|Use verified history as a risk input and keep current facts separate.|Recorded deposit outcomes
Q|Buyer wants to assign again.|Check the actual contract and permitted chain before accepting.|Assignment restrictions
Q|Buyer says their partner will sign.|Collect the authorized entity signer.|Partner authority and identity
Q|Buyer asks to reserve before signing.|Explain the real reservation requirements; do not promise exclusivity.|Signature and cleared deposit conditions
''')
group('Showing availability','Showings','config/turnkey-deal-journey.sql,config/buyer-call-package-showings.sql','Viewing coordination','G09','Collect a specific slot and both parties’ confirmation before booking.','''
Q|Buyer wants to see it today.|Request available slots and check seller or occupant permission.|Exact slot and access authorization
Q|Seller gives only evenings.|Ask for dates, AM/PM time and timezone.|Dated availability
Q|Buyer is in a different timezone.|Display both the property timezone and unambiguous appointment time.|Property timezone and exact instant
Q|Seller gives three options.|Offer only those current slots to the buyer.|Seller-confirmed availability window
Q|Buyer asks for a virtual showing.|Check supported host and media access before promising it.|Authorized host and connection
Q|Buyer sends an inspector instead.|Obtain attendee identity and access approval.|Named attendee and permission
Q|Seller wants twenty-four hours notice.|Apply the actual notice requirement to eligible slots.|Notice rule and current time
Q|A tenant must approve access.|Request confirmation from the authorized occupant route.|Tenant or manager access approval
Q|No available times overlap.|Collect alternatives from each party without inventing a booking.|Both parties’ availability
Q|Buyer asks for the lockbox code.|Share only through an authorized, time-bound access process.|Access authorization and identity
''')
group('Showing changes and outcomes','Showings','config/buyer-call-package-showings.sql,config/title-tasks.sql','Viewing coordination','G09','Update the specific visit and trigger the next property decision.','''
Q|Buyer is thirty minutes late.|Ask seller or occupant to confirm the changed arrival time.|Current visit and revised consent
Q|Seller cancels the visit.|Cancel that visit, notify through permitted channels and request alternatives.|Cancellation source
Q|Buyer does not show up.|Record the actual missed visit and ask once about rescheduling.|Attendance evidence
Q|Seller is not home.|Keep access unconfirmed and coordinate a new slot.|On-site report and owner response
Q|The lockbox code fails.|Contact the authorized access holder; do not guess codes.|Verified access contact
Q|An unauthorized person arrives.|Do not disclose access; verify the attendee.|Approved attendee identity
Q|The visit finishes successfully.|Ask for the buyer’s specific next decision.|Confirmed visit outcome
Q|Buyer sees worse condition than expected.|Collect the new facts and route re-underwriting.|Photos or inspection findings
Q|Buyer wants a second visit.|Check current availability and inspection deadline.|Current contract and access rights
Q|Property is reserved before the visit.|Recheck whether the visit remains authorized and cancel obsolete slots.|Reservation and current buyer rights
''')
group('Inspection scheduling','Inspection','config/title-tasks.sql,config/turnkey-deal-journey.sql','Coordination and closing tasks','G04','Coordinate a permitted inspection before the actual deadline.','''
Q|Inspector has no opening before deadline.|Seek an available qualified inspector or an authorized extension.|Inspector availability and signed deadline
Q|Utilities are off.|Ask the authorized party for a safe inspection plan.|Utility status and property access
Q|Inspection cost is not assigned.|Clarify the responsible payer before ordering paid work.|Authorized payer and cost limit
Q|Seller refuses invasive testing.|Respect the limit and ask about permitted inspection scope.|Written access scope
Q|Buyer requests a sewer scope.|Coordinate qualified access within contract rights.|Inspection permission and appointment
Q|Structural engineer is needed.|Request qualified availability and track the report.|Engineer engagement and deadline
Q|Inspector needs attic access.|Ask the owner or occupant for a safe access arrangement.|Access permission
Q|Weather prevents the inspection.|Reschedule within rights or request an extension.|Weather impact and available dates
Q|Inspector sends the report to the wrong person.|Use a verified authorized delivery route.|Recipient authorization
Q|Inspection appointment is double-booked.|Resolve conflicts before confirming either visit.|Current calendar and party confirmation
''','R4')
group('Inspection results and renegotiation','Inspection','lib/automatic-call-offer.ts,config/closing-completion.sql','Property details and closing tasks','G04','Evaluate actual findings and seek explicit agreement for changed terms.','''
Q|Inspection finds a major foundation issue.|Re-underwrite with the report and discuss supported options.|Qualified report and revised estimate
Q|Repair bids differ substantially.|Compare scope and evidence before changing the estimate.|Itemized bids
Q|Buyer requests a repair credit.|Check delegated economics and obtain required agreement.|Credit amount and signed terms
Q|Seller offers to repair instead.|Clarify scope, completion evidence and buyer acceptance.|Repair agreement and deadline
Q|Inspection finds no major problems.|Record evidence and progress without inventing a guarantee.|Completed report
Q|Buyer cites a problem without evidence.|Request the report or photos before a price revision.|Specific issue evidence
Q|A pest report recommends treatment.|Track the actual recommendation and agreed response.|Pest report and treatment terms
Q|Insurance cannot be obtained at expected cost.|Obtain actual options and assess the buyer’s contractual dependency.|Insurance evidence and terms
Q|Appraisal is below buyer price.|Distinguish valuation from a contractual financing right.|Appraisal and applicable contingency
P|Buyer wants to cancel after inspection.|Assemble the request, report and notice deadline for authorized resolution.|Contractual termination rights
''','R4')
group('Assignment and buyer signatures','Contracts','lib/deal-journey-service.ts,config/turnkey-deal-journey.sql','Assignment and coordination','G06','Prepare the exact current buyer agreement and collect the required signatures.','''
Q|Buyer requests the assignment.|Reuse their request and collect only missing signer details.|Current buyer request and terms
Q|Buyer wants another LLC on the agreement.|Verify the new entity and prepare an authorized change.|Entity and signer authority
Q|Assignment price differs from the package.|Hold the conflicting draft and resolve the operative terms.|Published ask and accepted version
Q|Deposit amount is wrong.|Correct through the current document workflow before execution.|Agreed deposit and document hash
Q|Buyer signs but customer has not.|Present the exact document for the remaining authorized signature.|Ordered signature receipts
Q|Buyer signs an obsolete version.|Reconcile which version is binding before advancing.|Envelope and version history
Q|Buyer asks to remove non-refundable wording.|Capture the change and check actual authority and rights.|Requested clause change
Q|A signing link is forwarded.|Verify the signer through the actual provider process.|Signer identity and envelope role
Q|Buyer refuses the assignment structure.|Explain it honestly and close that path if refusal remains.|Explicit buyer preference
Q|Two assignments are generated for one deal.|Fence duplicate commitment and reconcile original envelope outcomes.|Both original operations and reservation state
''','R3')
group('Deposit instructions and payment claims','Payments','config/closing-confirmations.sql,lib/deal-completion.ts','Deposit and closing progress','G13','Obtain verified receiving instructions and reconcile the exact required deposit.','''
Q|Buyer asks where to send the deposit.|Direct them to the verified escrow process and exact agreement.|Verified payee and deposit obligation
Q|Buyer sends a payment screenshot.|Record it as a claim and ask escrow to verify cleared receipt.|Independent escrow receipt
Q|Buyer paid only part of the deposit.|Record the verified partial amount without granting full reservation.|Cleared amount and required total
Q|Buyer says the wire is pending.|Track the original transfer without declaring receipt.|Bank or escrow transfer status
Q|Buyer wants to pay by check.|Confirm whether the verified escrow accepts it and when it clears.|Escrow payment method policy
Q|Buyer requests Zelle or Cash App.|Do not invent a handle; obtain approved receiving instructions.|Verified supported payment route
Q|Deposit is due on a weekend.|Ask escrow for the actual timing under the signed agreement.|Contract deadline and escrow availability
Q|Buyer paid the wrong amount.|Reconcile actual funds and obtain the required adjustment instruction.|Cleared receipt and agreement amount
Q|Deposit receipt references another property.|Resolve the property and payer binding before crediting it.|Exact escrow file and transfer reference
Q|Buyer says payment means the deal is reserved.|Check both executed agreement and cleared required funds.|Signature and reservation conditions
''','R6')
group('Deposit failures and refunds','Payments','config/closing-completion.sql,config/closing-coordination.sql','Deposit and closing tasks','G13','Reconcile money evidence and pursue the authorized contractual resolution.','''
Q|Deposit deadline passes unpaid.|Send the permitted due reminder and prepare the specific next decision.|Deadline and verified nonreceipt
Q|The check is returned.|Remove unsupported cleared status only from authoritative reversal evidence.|Return receipt and original payment
Q|Wire is rejected by receiving bank.|Request verified correction through escrow; do not retry funds automatically.|Bank rejection and verified payee
P|Buyer asks for a deposit refund.|Apply the actual contract and applicable rights through the authorized party.|Signed terms and cancellation facts
P|Seller breach is alleged.|Preserve evidence and route the specific dispute to qualified resolution.|Breach evidence and governing contract
Q|Buyer claims they sent two deposits.|Reconcile distinct transfer references before claiming duplicate funds.|Independent payment receipts
P|Parties disagree who gets escrow money.|Track the dispute and required release instructions.|Escrow dispute procedure
Q|A deposit receipt is reversed.|Recompute reservation from the verified latest funds state.|Authoritative reversal
Q|Buyer wants to substitute a different payer.|Obtain escrow requirements and entity authorization.|Payer identity and escrow acceptance
P|Buyer requests immediate off-platform repayment.|Require the authorized verified refund process.|Verified refund authority and recipient
''','R6')
group('Title company selection','Title','lib/title-directory-service.ts,config/title-directory.sql','Closing setup','G08','Find a suitable closing office, verify its contact and obtain transaction acceptance.','''
Q|No title company is selected.|Search approved sources and request assignment-transaction capability.|Property jurisdiction and title requirements
Q|Buyer recommends a title company.|Treat it as a preference and verify it independently.|Company identity and coverage
Q|Seller insists on a specific closer.|Check the agreement and whether that closer can handle the transaction.|Contract selection rights
Q|Title company refuses assignments.|Seek an eligible alternative without changing the transaction secretly.|Verified refusal and authorized options
Q|The proposed closer is outside the state.|Verify coverage and required local closing role.|Jurisdiction and licensing or attorney requirements
Q|The closer contact has expired.|Reverify through a trusted channel.|Fresh contact verification
Q|Two companies say they opened files.|Resolve the authoritative file before further instructions.|Party choice and file records
Q|Closer fees appear excessive.|Request itemized fees and compare within authorized selection policy.|Itemized quote and payer allocation
Q|The old successful closer is suggested again.|Reuse as a preference while checking this property and current contact.|Current coverage and verification
Q|A closing attorney is required locally.|Route to an appropriate verified professional.|Applicable jurisdiction policy
''','R5')
group('Title opening and documents','Title','lib/title-service.ts,lib/title-update-service.ts','Title messages and closing tasks','G08','Deliver the executed document set once and obtain a verified file acceptance.','''
A|Purchase agreement is fully signed.|Queue fulfillment and the authorized title-opening workflow.|Canonical purchase signature receipts
Q|Title says an attachment is missing.|Provide the authorized existing document through the same file thread.|Exact requested document and recipient
Q|Assignment signs after title opens.|Send the executed assignment update once.|Verified assignment and title file
Q|PDF exceeds the transport limit.|Use the approved secure document method instead of dropping it.|Document size and authorized secure route
Q|Title email bounces.|Verify a corrected contact before a new independently authorized message.|Terminal bounce and verified contact
Q|Title has not acknowledged opening.|Follow the existing bounded follow-up and request file reference.|Original delivery and reply status
Q|File reference is missing.|Ask the verified closer for its file number.|Current closer and transaction
Q|Closer needs entity documents.|Request the specific documents from the authorized owner.|Document requirement and entity
Q|Closer needs identification.|Direct upload through the verified secure process.|Secure intake instructions
Q|Title asks for a corrected contract.|Determine whether a correction or signed amendment is needed.|Specific discrepancy and authority
''','R5')
group('Title defects and liens','Title','config/title-tasks.sql,config/closing-coordination.sql','Closing tasks','G08','Track the specific cure, responsible party and deadline without claiming clear title prematurely.','''
P|An old mortgage release is missing.|Request the lender release through the closer.|Recorded lien and payoff or release evidence
P|A judgment lien appears.|Obtain the closer’s requirements for resolution.|Title finding and legal applicability
P|Property taxes are delinquent.|Request current payoff and settlement allocation.|Tax payoff statement
P|An HOA lien exists.|Request the HOA payoff or release requirements.|HOA ledger and lien evidence
P|A mechanics lien is recorded.|Route the disputed or payable claim through the closer.|Lien record and cure requirements
P|Legal description does not match.|Obtain survey and title correction requirements.|Deed, survey and contract description
P|An easement affects access.|Collect the recorded terms and buyer response.|Recorded easement and property impact
P|A boundary encroachment is found.|Request the title and survey resolution path.|Survey and title requirements
P|A bankruptcy stay may apply.|Stop conflicting commitments and obtain qualified clearance.|Court status and legal authority
P|A foreclosure deadline is imminent.|Escalate the real deadline to qualified parties and verify available options.|Recorded deadline and authorized resolution
''','R5')
group('Payoffs and seller proceeds','Payments','lib/closing-setup.ts,config/closing-coordination.sql','Closing progress','G13','Reconcile itemized obligations and obtain verified settlement figures.','''
Q|Mortgage payoff is larger than expected.|Recalculate the proposed seller net and request the current payoff.|Dated lender payoff
Q|Payoff quote expires before closing.|Request an updated quote through the closer.|Payoff validity date
Q|Per-diem interest changes the total.|Use the actual closing date and lender calculation.|Current payoff terms
Q|Seller confuses loan balance with payoff.|Explain the distinction and request the official payoff.|Lender payoff statement
Q|HOA fees are missing from the estimate.|Obtain the resale or payoff information and allocate per terms.|HOA statement
Q|Utility arrears may affect closing.|Ask the closer which obligations attach or require settlement.|Verified local requirements
Q|Seller wants an exact net today.|Show a clearly provisional calculation until all costs are verified.|Itemized current obligations
Q|A payoff account number changes.|Require independent verification through the trusted contact.|Verified lender instructions
Q|Proceeds are payable to an estate.|Obtain the legally authorized payee requirements.|Estate and escrow authority
Q|Seller wants proceeds split among owners.|Route the requested allocation through title and required consent.|Ownership and signed disbursement instructions
''','R6')
group('Closing scheduling and readiness','Closing','config/title-tasks.sql,config/closing-coordination.sql','Closing progress','G07','Confirm the actual date, required documents and funding readiness.','''
Q|Title proposes a closing time.|Obtain required party availability before marking scheduled.|Verified closer and party confirmation
Q|Seller cannot attend in person.|Ask the closer for supported remote or mobile signing options.|Identity and notarization requirements
Q|Buyer is traveling.|Coordinate a supported appointment without altering deadlines silently.|Buyer availability and closer options
Q|Notary is unavailable.|Find a supported replacement through the closer.|Qualified notary and appointment
Q|Funds have not arrived by cutoff.|Track verified funding status and obtain a revised plan.|Escrow funding receipt and cutoff
Q|Closing documents are incomplete.|Request the exact missing document and owner of that task.|Document checklist
Q|Final walkthrough reveals new damage.|Collect evidence and route the contractual resolution.|Walkthrough findings and signed terms
Q|Seller has not vacated.|Resolve possession according to the agreement.|Possession clause and current occupancy
Q|Recording office is closed.|Ask title how this affects funding, recording and possession.|Local recording and escrow procedure
Q|Title says ready to close.|Verify each required milestone rather than equating readiness with completion.|Signatures, funds and closing conditions
''','R4')
group('Closing evidence and disbursement','Closing','config/closing-confirmations.sql,config/closing-completion.sql','Closing and payment progress','G13','Distinguish signed documents, completed closing, disbursement and money actually received.','''
Q|Title says the file is closed.|Verify the specific completed-closing evidence and date.|Verified closer confirmation
Q|Documents are signed but not funded.|Keep closing completion pending until the required conditions are met.|Funding and completion evidence
Q|Title reports proceeds wired.|Record disbursement separately from bank receipt.|Amount, date and reference
P|Customer confirms money arrived.|Match their authorized receipt to the verified disbursement.|Receipt, amount and closing update
Q|Amount received differs from expected.|Reconcile settlement statement and actual receipt.|Itemized settlement and bank receipt
Q|Check was mailed but not received.|Track delivery through title without claiming received proceeds.|Check issue and delivery evidence
Q|Wire receipt is from a different file.|Reject the mismatch and request the correct evidence.|Exact file and payee
Q|Closing confirmation has a future date.|Record a scheduled event, not a completed closing.|Confirmed effective date
Q|A late webhook repeats disbursement.|Deduplicate the original evidence without adding revenue.|Stable transfer reference
Q|Closing is reversed or disputed later.|Preserve history and record the correction explicitly.|Authoritative corrective evidence
''','R6')
group('Payment fraud and identity changes','Payments','lib/title-inbound-policy.ts,config/title-inbound.sql','Private closing task and verified contact','G13','Stop only the unsafe financial step and independently verify the instruction.','''
P|Email supplies new wire instructions.|Verify through a previously trusted contact before use.|Independent payee verification
P|Closer email uses a lookalike domain.|Reject automatic trust and verify the real office.|Trusted company contact
P|Buyer sends a forged deposit receipt.|Keep it unverified and obtain escrow confirmation.|Independent original receipt
P|An urgent message asks for gift cards.|Reject the request as outside the transaction’s payment path.|Actual agreement and verified payment route
P|Seller identity changes before closing.|Recheck title and identity through secure intake.|Current identity and authority
P|New phone number requests bank details.|Do not disclose; verify authority through the established route.|Verified identity binding
P|Email asks to redirect assignment proceeds.|Require authorized payee change verification.|Signed authority and independently verified instructions
P|Title portal link points to an unknown host.|Use the established verified portal route.|Verified portal origin
P|Money may have gone to the wrong account.|Present urgent bank and closing-contact response steps and preserve evidence.|Original transfer and verified contacts
P|A third party asks for the seller’s ID.|Share only through an authorized secure recipient process.|Recipient authority and data purpose
''','R6')
group('Buyer withdrawal and replacement','Buyers','config/closing-completion.sql,lib/buyer-engine.ts','Buyer coordination','G12','Resolve current obligations and resume only authorized replacement-buyer work.','''
Q|Buyer loses interest before signing.|Close their active request and continue eligible matching.|Explicit withdrawal and current obligations
Q|Buyer stops responding before deposit.|Use bounded follow-ups and prepare the exact deadline decision.|Delivered requests and signed deadlines
Q|Buyer financing fails.|Capture the failure and check contractual options.|Funding evidence and terms
P|Buyer withdraws after signing.|Route termination and deposit obligations through the authorized process.|Executed assignment and withdrawal
Q|Backup buyer is ready.|Verify availability and existing commitments before offering reservation.|Current reservation and backup qualification
Q|Seller wants another buyer immediately.|Explain current obligations and pursue permitted alternatives.|Existing contract and termination status
Q|Replacement buyer wants new terms.|Re-underwrite and obtain required new acceptance.|Authorized price and revised terms
Q|Original buyer returns after replacement.|Check current binding state; do not create competing commitments.|Current assignment and reservation
Q|Buyer requests time to find a partner.|Record a bounded request without extending a deadline automatically.|Specific date and authorized extension
Q|No buyer can meet the closing date.|Pursue a supported extension or authorized exit before expiry.|Actual buyer readiness and contractual options
''','R1')
group('Seller withdrawal and disputes','Contracts','config/closing-completion.sql,lib/signing-service.ts','Contracts and closing tasks','G06','Preserve the contract state and pursue the specific authorized resolution.','''
Q|Seller withdraws before accepting.|End active negotiation and cancel unsent commitment work.|Latest explicit withdrawal
Q|Seller refuses to sign after verbal acceptance.|Ask what specific term or access problem prevents signing.|Exact objection and current draft
P|Seller wants to cancel a signed contract.|Collect the request and route the governing rights and notice requirements.|Executed contract and cancellation grounds
P|Seller accepts a competing signed offer.|Preserve evidence and seek qualified resolution of conflicting obligations.|Both contractual claims
Q|Seller accuses the bot of changing the price.|Compare original delivered and signed terms and correct the factual explanation.|Versioned messages and documents
P|Seller disputes assignment disclosure.|Provide actual disclosure evidence and route unresolved legal issues.|Signed disclosure and communication history
Q|Seller says they never received the agreement.|Reconcile original delivery and offer a valid supported access path.|Envelope and delivery evidence
Q|Seller requests a human during a dispute.|Honor the handoff and present the specific issue with its deadline.|Human request and case facts
P|Seller alleges coercion or incapacity.|Stop automated commitment and route to qualified resolution.|Allegation and authority evidence
P|Parties agree to mutual cancellation.|Use the approved cancellation document and actual signatures.|Authorized release and escrow instructions
''','R3')
group('Jurisdiction and transaction eligibility','Title','lib/signing-policy.ts,lib/buyer-disposition.ts','Contract requirements','G14','Resolve the applicable state requirement before that specific regulated action.','''
Q|Texas assignment disclosure is missing.|Use the applicable written disclosure before the relevant transaction step.|Current Texas rule and approved document
Q|Oregon wholesaler registration is unverified.|Verify required registration or licensing before covered activity.|Current Oregon eligibility
Q|Property is in a newly added state.|Load an approved current jurisdiction policy instead of assuming nationwide uniformity.|State rules and effective date
Q|Contract prohibits assignment.|Honor the restriction and determine a supported alternative with proper authority.|Executed assignment clause
Q|Seller consent to assignment is required.|Collect the required written consent.|Contract condition and actual consent
Q|Buyer requests a double closing.|Capture the request and verify funding and approved structure.|Authorized structure and closing capability
Q|Advertising implies property ownership.|Describe the actual equitable interest accurately.|Contract-holder status and disclosure
Q|A local rule changes during the deal.|Apply effective-date and existing-contract analysis through qualified policy.|Current authoritative rule
Q|Required broker or attorney involvement is absent.|Obtain the required professional participation for that step.|Jurisdiction requirements
Q|The property type is outside approved scope.|Stop that unsupported transaction path while other deals continue.|Property type and product scope
''','R3')
group('Delivery failures and uncertain outcomes','Reliability','lib/deal-journey-service.ts,lib/title-service.ts','Existing activity history; private diagnostics','G15','Reconcile the original operation and continue independent work.','''
A|Text provider confirms terminal rejection.|Use the existing permitted recovery only from that terminal evidence.|Original rejection and recipient eligibility
Q|Text provider accepted but delivery is unknown.|Poll the original receipt; do not resend blindly.|Original message ID
Q|Call creation times out.|Reconcile the exact request; do not redial from a timeout alone.|Call request nonce and carrier identity
Q|Contract creation succeeds but database save fails.|Recover the same envelope by its original idempotency identity.|Provider envelope and original claim
Q|Title email times out after submission.|Reconcile the original email rather than issue a duplicate.|Original email idempotency key
A|Provider rate limit includes a retry time.|Resume eligible unsent work after the exact retry boundary.|Provider retry evidence and final admission
Q|Webhook arrives before API response.|Merge both into the same operation once.|Canonical operation identity
Q|Webhook signature is invalid.|Reject it and retain the original state for trusted reconciliation.|Verified webhook authenticity
A|One provider lane is unavailable.|Continue unrelated permitted work through healthy lanes.|Independent lane eligibility
Q|Provider says delivered after a local timeout.|Attach the late receipt and resolve the original wait without replay.|Exact late receipt
''')
group('Concurrency, budgets and account controls','Reliability','config/deal-supervisor.sql,lib/deal-supervisor.ts','Saved Run/Pause and activity','G15','Allow only the latest account-bound action and keep unrelated eligible work moving.','''
S|Customer presses Pause during preparation.|Recheck Pause at final admission and cancel unsent execution.|Current account control
S|Customer takes over while AI drafts.|Preserve the human thread and prevent stale automatic reply.|Current takeover version
Q|Two workers claim one contract.|Allow one durable claim and make the other observe its result.|Unique operation key
Q|Two accounts share a seller phone.|Preserve recipient and account routing without duplicate cold outreach.|Global recipient history and tenant ownership
Q|Wallet cannot fund the next operation.|Expose the exact funding dependency and keep free reconciliation active.|Available funds after real holds
Q|A provider cost is unresolved.|Retain that financial uncertainty while independent eligible deals continue.|Original cost receipt and reservation
Q|An old worker runs after a release.|Require compatible operation and terms versions at final claim.|Release and schema compatibility
Q|A cancellation arrives before dispatch.|Reject obsolete side effects using the latest cancellation state.|Current deal revision
A|An account has no queued work but fresh eligible source.|Repair only the missing local job with a unique source key.|Fresh source and all current admission gates
A|One deal repeatedly fails supervisor checks.|Back off that deal with a concrete reason while processing others.|Per-deal error and retry deadline
''')
group('UI truth, next steps and outcome learning','UI','lib/deal-journey-progress.ts,lib/workspace-guidance.ts','Existing property card, thread and closing panel','G16','Show the actual next action and update from confirmed events without redesigning the workspace.','''
Q|A queued text appears as sent.|Display queued until the provider accepts the original message.|Actual operation state
Q|A verbal yes appears under contract.|Keep interested or negotiating until required signatures are verified.|Canonical signature evidence
Q|A proposed showing appears confirmed.|Show waiting on each party until both confirm.|Separate confirmation receipts
Q|Buyer claims deposit but UI says reserved.|Require the signed agreement and verified cleared deposit.|Actual reservation conditions
Q|Title sent an email but UI says title opened.|Wait for verified office acceptance.|Title-opening confirmation
Q|A closed label appears as money earned.|Separate closed, disbursed and proceeds received.|Matched closing and receipt evidence
Q|Background error hides saved conversation.|Keep saved history visible and route technical diagnostics privately.|Last successful data and fetch state
Q|Generic review has no next step.|Replace it with the specific missing item, responsible party and due action.|Structured blocker reason
Q|Old facts overwrite a newer seller response.|Display latest authoritative facts with their source version.|Event ordering and revision
Q|A synthetic scenario is counted as a successful deal.|Exclude fixtures from conversion and revenue reports.|Live-source and outcome classification
''')

# Each real-world situation is exercised against five distinct workflow states.
# They are design/acceptance scenarios. No scenario is claimed executed here.
BRANCHES = [
 ('current','Current evidence','The event is fresh, correctly bound and all stated prerequisites are present.'),
 ('missing','Required evidence missing','The required evidence named in this scenario is missing or incomplete.'),
 ('changed','Newer conflicting event','A newer correction, withdrawal, changed term or control arrives before execution.'),
 ('uncertain','Execution acknowledgement missing','The selected permitted action was claimed, but its acknowledgement is lost.'),
 ('overdue','Next checkpoint overdue','The recorded follow-up or verification deadline arrives without the expected result.'),
]

def build():
    assert len(GROUPS)==40,len(GROUPS)
    scenarios=[]
    for gi,g in enumerate(GROUPS,1):
        for ci,c in enumerate(g['cases'],1):
            base=f'W{gi:02d}-{ci:02d}'
            for vi,(key,label,condition) in enumerate(BRANCHES,1):
                is_stop=c['mode']=='S'
                if key=='current':
                    action=c['action']
                    status='Stopped' if is_stop else ('Waiting on authorized person' if c['mode']=='P' else 'AI working')
                    next_action='Preserve the refusal and cancel unsent conflicting work.' if is_stop else g['next_step']
                elif key=='missing':
                    action=('Persist the refusal immediately even when optional property data is missing.' if is_stop else 'Identify and request only this missing prerequisite: '+c['evidence']+'. Continue independent eligible tasks.')
                    status='Stopped' if is_stop else 'Waiting on specific information'
                    next_action='Recheck unsent work for the refused route.' if is_stop else 'Resume the original step when the named evidence is received and validated.'
                elif key=='changed':
                    action=('Keep the refusal effective; a later opt-in requires its own valid source and applicable permission checks.' if is_stop else 'Supersede the stale plan. Re-read the newest event, current terms and controls before selecting a new action for: '+c['event'])
                    status='Stopped' if is_stop else 'Updating next action'
                    next_action='Admit no outreach from old permission.' if is_stop else 'Save a new source-bound plan, or stop if the latest event withdraws authority.'
                elif key=='uncertain':
                    action=('Read back the durable suppression and cancel any still-unsent work; do not contact the recipient to verify opt-out.' if is_stop else 'Reconcile the original action and exact receipt for: '+c['action']+' Do not repeat a possibly completed external action.')
                    status='Stopped' if is_stop else 'Checking original action'
                    next_action='Confirm suppression without outbound contact.' if is_stop else 'Resume only after the original result is known; keep independent work eligible.'
                else:
                    action=('Keep this recipient stopped; elapsed time does not renew permission.' if is_stop else 'Check the specific expected result for: '+c['event']+' Use a permitted bounded reminder or verification; if still missing, identify the exact responsible party and next deadline.')
                    status='Stopped' if is_stop else 'Following up on missing result'
                    next_action='No automatic cold follow-up.' if is_stop else 'Record a new check time or a specific terminal outcome; never silently extend signed deadlines.'
                scenarios.append(dict(id=f'{base}-{vi}',baseId=base,category=g['name'],lane=g['lane'],event=c['event'],branch=label,condition=condition,
                  action=action,requiredEvidence=c['evidence'],uiSurface=g['surface'],uiState=status,nextStep=next_action,
                  authority={'A':'Automatic within existing authority','Q':'Clarify or gather evidence automatically','P':'AI coordinates; authorized party performs decision or signature','S':'Stop or honor customer control'}[c['mode']],
                  checkpoint=('Immediate suppression; no marketing reminder' if is_stop else 'Use actual contract/appointment deadline; internal unclaimed work target within 5 minutes; external follow-up only at the permitted recorded time'),
                  existingPaths=g['paths'],gap=g['gap'],researchSource=g['source'],validation='Design scenario; not executed against production'))
    assert len(scenarios)==2000
    assert len({s['id'] for s in scenarios})==2000
    assert len({s['event'] for s in scenarios})==400
    out=ROOT/'docs/scenarios/wholesale-2000.json'
    out.write_text(json.dumps(dict(schemaVersion=1,baseSituations=400,totalScenarios=2000,branches=[x[1] for x in BRANCHES],scenarios=scenarios),indent=2)+'\n')
    print(json.dumps({'baseSituations':400,'scenarios':len(scenarios),'categories':len(GROUPS),'path':str(out)}))

if __name__=='__main__': build()
