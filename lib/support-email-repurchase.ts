/** A proposed second purchase is not an access repair or an approved refund. */
export function supportEmailRepurchaseReply(question:string,latestOperator=''){
 // An earlier completed financial or identity finding belongs to its existing
 // workflow; a new reply must not replace it with an unconfirmed outcome.
 if(/\b(?:refund|email correction|checkout email)\s+(?:(?:is|was|has been)\s+)?(?:approved|issued|completed|corrected)\b/i.test(latestOperator))return null;
 const refund=/\b(?:refund|money back)\b/i.test(question);
 const repurchase=/\b(?:buy|pay|purchase)\b.{0,30}\bagain\b|\brepurchase\b/i.test(question);
 const email=/\b(?:e-?mail|icloud|relay address)\b/i.test(question);
 const problem=/\b(?:wrong|incorrect|different|another|right|new|unavailable|inaccessible|temporary|change|correct|cannot|can[’']t|unable)\b/i.test(question);
 const excluded=/\b(?:seller|buyer|property|house|contract|hypothetical|hypothetically|suppose|someone else|my friend)\b/i.test(question)
  ||/\b(?:do not|don[’']t|no longer|never)\s+(?:want|need|request|ask for)\s+(?:a\s+)?(?:refund|money back)\b|\bnot (?:asking for|requesting) (?:a )?refund\b|\bno refund\b/i.test(question)
  ||/\b(?:do not|don[’']t|won[’']t|will not|not going to)\s+(?:buy|pay|purchase)\b|\b(?:refund (?:arrived|received)|already refunded|access (?:works|restored)|signed in successfully)\b/i.test(question);
 if(!refund||!repurchase||!email||!problem||excluded)return null;
 return {reply:'You’re asking for a refund so you can purchase again with another email. Don’t pay again to fix access. The refund policy is unchanged; this reply has not approved or issued a refund. Ownership and conflicting-account checks determine whether a purchase contact-email correction or the existing account-recovery workflow applies. That does not change your email-provider address. Keep any proof already supplied in this review. Your refund request and access problem need management review; this reply does not change an email or confirm restored access.',status:'open' as const,managementReview:true as const,ai:false as const};
}
