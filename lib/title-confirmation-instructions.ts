/** Deliberately no sample completed milestone that a quoted reply could accidentally confirm. */
export const titleConfirmationInstructions=`Please reply normally with your file status, confirmed dates, amounts and any documents you need. Our team can review ordinary replies in the workspace. For optional automatic status updates, send a separate plain-text reply containing only these six lines, replacing each placeholder with confirmed facts:
ICASH CONFIRMATION
Status: <title_opened, deposit_received, closing_scheduled, closed, or funds_disbursed>
Date: <YYYY-MM-DD or none>
Amount cents: <whole USD cents or none>
File: <your file or payment reference>
END ICASH CONFIRMATION
Use funds_disbursed only after your office has sent the customer's proceeds, with the actual amount, date and reference. This reports sending, not bank receipt. If the buyer has changed, include the exact Agreement line from the latest signed-assignment delivery; the old thread alone does not identify the current buyer. Ordinary replies are also accepted and can be reviewed in the app.`;

/** Bind new instructions to the actual attached agreement; never invent a reference. */
export function titleConfirmationInstructionsFor(agreementId:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agreementId))throw Error('Current agreement reference required');
 return titleConfirmationInstructions.replace('these six lines','these seven lines')
  .replace('\nEND ICASH CONFIRMATION',`\nAgreement: ${agreementId.toLowerCase()}\nEND ICASH CONFIRMATION`)
  .replace('If the buyer has changed, include the exact Agreement line from the latest signed-assignment delivery; the old thread alone does not identify the current buyer.','Keep the Agreement line exactly as shown for this attached agreement. After a buyer replacement, it is required for automatic updates. The old email thread or a previous buyer’s agreement does not identify the current buyer.');
}
