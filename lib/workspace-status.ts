export function workspaceStatus(a:{billingReview?:boolean;paused?:boolean;workReady?:boolean;balanceCents?:number;activeWork?:boolean;identity?:unknown}){
 if(a.billingReview)return {label:'PAYMENT REVIEW',title:'Your payment needs a review.',detail:'New work is paused. Your saved work remains available.'};
 if(!a.identity)return {label:'NEEDS YOU',title:'Add your contract name.',detail:'Add your full legal name or company so agreements use the correct buyer.'};
 if(a.paused)return {label:'PAUSED',title:'Your bot is paused.',detail:'Your opportunities and conversations are saved.'};
 if((a.balanceCents??0)<=0)return {label:'NO AVAILABLE CREDITS',title:'Your available credits are used up.',detail:'No new paid work can start without available credits.'};
 if(!a.workReady)return {label:'SETUP PENDING',title:'Your bot is awaiting live setup.',detail:'Live acquisition is still being configured. Your saved work is below.'};
 if(a.activeWork)return {label:'WORKING',title:'Your bot is working.',detail:'Open an opportunity below to see the numbers and conversations.'};
 return {label:'READY',title:'Ready for the next eligible task.',detail:'Your bot is waiting for work that passes contact, timing and budget checks.'};
}
