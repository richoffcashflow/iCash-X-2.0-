import {planSellerTextOffer} from '../../lib/seller-text-offer.ts';
export const now=Date.now();
export function sellerContext({value=175000,repairs=28000,payoff=10000,account='account',thread='thread'}={}){
 const c={accountId:account,jobId:'job',threadId:thread,sourceId:'',dealId:'deal',screeningId:'screen',phone:'+12145550123',ownerUserId:'owner',ownerEmail:'owner@example.invalid',principal:'Fixture Buyer',address:'100 Fixture Lane',
  snapshot:{propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:'100 Fixture Lane',estimated_value:value,estimated_repair_cost:repairs,total_estimated_loan_balance:payoff,estimated_equity_percentage:90}}},
  terms:{seller:'',buyer:'Fixture Buyer',address:'100 Fixture Lane',legalDescription:'Lot 1, Fixture subdivision',state:'TX',priceCents:null,priceSource:'proposed'},offerState:null,offerVersion:0,messages:[],fingerprint:'fixture'};
 const pair=(question,answer)=>{c.messages.push({id:'m'+c.messages.length,direction:'outgoing',state:'delivered',providerId:'receipt',body:question},{id:'m'+(c.messages.length+1),direction:'incoming',state:'received',providerId:null,body:answer});};
 for(const [question,answer] of [['Are you the owner of this property?','Yes'],['Are you looking to sell?','Yes'],['What has you thinking about selling?','I want to sell a property I have held for years'],['What repairs does it need?','It needs major work and a new roof'],['Is anyone living there?','It is vacant'],['When would you like to sell?','As soon as possible'],['Is it listed with a real estate agent?','No']])pair(question,answer);
 return c;
}
export function sellerTurn(c,body,{delivery='delivered'}={}){
 const source={id:'m'+c.messages.length,direction:'incoming',state:'received',providerId:null,body};
 c.messages.push(source);c.sourceId=source.id;
 const context=structuredClone(c),plan=planSellerTextOffer(context,now);
 c.offerState=structuredClone(plan.state);c.offerVersion++;
 if(plan.kind==='message')c.messages.push({id:'m'+c.messages.length,direction:'outgoing',state:delivery,providerId:delivery==='delivered'?'receipt-'+c.messages.length:null,body:plan.body,action:plan.action,quoteRevision:plan.state.quoteRevision,priceCents:plan.state.quotedPriceCents,updatedAt:new Date(now-60000).toISOString()});
 return {context,plan};
}
