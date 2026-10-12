'use client';
import {Crown,Mic} from 'lucide-react';
import {BotNameSettings} from '@/components/bot-name-settings';
import {VipCustomVoice} from '@/components/vip-custom-voice';
export function BotCustomization({name,vip,onSaved,onUpgrade}:{name:string;vip:boolean;onSaved:()=>Promise<unknown>;onUpgrade:()=>void}){
 return <div className="bot-customization">
  <BotNameSettings initialName={name} onSaved={onSaved}/>
  {vip?<VipCustomVoice/>:<section className="bot-voice-upgrade" aria-label="Custom voice with VIP">
   <div><Mic size={20} aria-hidden="true"/><strong>Custom voice</strong><span><Crown size={13} aria-hidden="true"/> VIP</span></div>
   <p>Let your bot call sellers using your own voice.</p>
   <button type="button" className="membership-payment-link" onClick={onUpgrade}>Explore VIP</button>
  </section>}
 </div>;
}
