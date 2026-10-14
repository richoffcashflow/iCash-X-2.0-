'use client';
import {Clock} from 'lucide-react';
import {formatWatchTime} from '@/lib/webinar-policy';

export function WebinarCountdownBanner({countdown}:{countdown:{label:string;remaining:number}|null}){
 if(!countdown)return null;
 return <section className="wb-countdown-banner" aria-label="Offer countdown">
  <div><Clock size={20} aria-hidden="true"/><span>{countdown.label}</span><strong role="timer" aria-label={`${countdown.label}: ${formatWatchTime(countdown.remaining)}`}>{formatWatchTime(countdown.remaining)}</strong></div>
 </section>;
}
