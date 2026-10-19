export function ownerOutreachFixture(url,label='123 Example Street'){
 const p=new URL(url,'https://example.invalid').searchParams;
 const days=Number(p.get('days')??30),includeOwner=p.get('includeOwner')==='true',query=p.get('q')??'',page=Number(p.get('page')??1),status=p.get('status')??'all';
 const activity={calls:4,conversations:2,callResponses:1,unanswered:1,busy:1,failed:0,textsAccepted:5,textsDelivered:3,textReplies:2,queuedCalls:1,queuedTexts:2,heldCalls:1,heldTexts:1};
 const row={id:'00000000-0000-4000-8000-000000000001',accountId:'00000000-0000-4000-8000-000000000002',account:'Example customer',address:label,paused:false,eligible:true,responded:true,interested:false,optedOut:false,latestAt:'2026-10-19T19:30:00Z',...activity};
 const leads=query==='missing'||status==='interested'||page>1?[]:[row];
 return {report:{days,includeOwner,query,page,status,pageSize:25,timezone:'America/Chicago',startAt:'2026-10-19T05:00:00Z',endAt:'2026-10-19T20:00:00Z',matchedCount:query==='missing'||status==='interested'?0:1,totals:{researched:20,eligible:12,accounts:1,respondedProperties:1,interestedProperties:0,...activity},leads}};
}
