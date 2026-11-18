// Source-text fixtures only. These are not contact authorizations or live replies.
export const sellerPauseCases=[
 ...['Pause','PAUSE.','Please pause','Pause please','Pause here','Pause for now','Please pause here for now.','Okay, pause here.','Yes, pause please','  Pause\n'].map(body=>[body,'review']),
 ...['Pause?','Can you pause the contract?','Pause the closing','Pause the payment','Pause recording','Pause calls but text me','Do not pause','Please do not pause','I did not say pause','You said "Pause"','The word pause','Never pause','Pause the video','Press 1 to pause','Pause here if the price changes','Continue, do not pause'].map(body=>[body,null]),
];
