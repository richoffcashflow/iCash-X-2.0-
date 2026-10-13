'use client';
import {useEffect, useRef, useState} from 'react';
import {Clock, Volume2, VolumeX} from 'lucide-react';
import {formatWatchTime} from '@/lib/webinar-policy';


type Offer = {id: string; title: string; ctaLabel: string; expiresAt?: string | null};

export function WebinarOfferMoment({offer, now, onOpen, checkoutEngaged}: {
  offer?: Offer | null; now: number; onOpen: () => void; checkoutEngaged: boolean;
}) {
  const [sound, setSound] = useState(true);
  const [audioReady, setAudioReady] = useState(false);
  const context = useRef<AudioContext | null>(null);
  // Unlock sound on an actual interaction, including the video's play button.
  useEffect(() => {
    let disposed = false;
    const unlock = () => {
      try {
        if (!window.AudioContext) return;
        const audio = context.current ??= new AudioContext();
        void audio.resume().then(() => {if (!disposed) setAudioReady(audio.state === 'running');}).catch(() => {});
      } catch { /* Sound is optional; unsupported browsers retain the countdown. */ }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      disposed = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      void context.current?.close().catch(() => {});
      context.current = null;
    };
  }, []);
  const deadline = Date.parse(offer?.expiresAt ?? '');
  const offerRemaining = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  const remaining = offerRemaining;
  const lastChance = !!offer && offerRemaining !== null && offerRemaining > 0 && offerRemaining <= 300;
  const ticking = !!offer && !checkoutEngaged && remaining !== null && remaining > 0 && remaining <= 60;
  const fast = remaining !== null && remaining <= 10;
  useEffect(() => {
    if (!sound || !audioReady || !ticking) return;
    const tick = () => {
      const audio = context.current;
      if (document.hidden || !audio || audio.state !== 'running') return;
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(1200, audio.currentTime);
      gain.gain.setValueAtTime(0.035, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.035);
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.onended = () => {oscillator.disconnect(); gain.disconnect();};
      oscillator.start(); oscillator.stop(audio.currentTime + 0.04);
    };
    const id = window.setInterval(tick, fast ? 500 : 1000);
    return () => window.clearInterval(id);
  }, [sound, audioReady, ticking, fast]);
  if (!offer || checkoutEngaged || offerRemaining === 0) return null;
  return <section className={`wb-offer-moment${lastChance ? ' wb-last-chance' : ''}`} aria-label="Webinar offer">
    <div><p className="wb-moment-eyebrow" role="status">{lastChance ? 'LAST CHANCE · OFFER CLOSING' : 'YOUR OFFER IS NOW OPEN'}</p>
      <h2>{lastChance ? 'Make your move before time runs out.' : offer.title}</h2>
      <p>{lastChance ? 'Review your offer and complete checkout before the deadline.' : 'Your next step is ready. Open the offer while you keep watching.'}</p>
    </div>
    {remaining !== null && remaining > 0 && <div className="wb-moment-clock"><span><Clock size={16}/>Offer closes in</span><strong role="timer" aria-label={`$Offer closes in: ${formatWatchTime(remaining)}`}>{formatWatchTime(remaining)}</strong>
      <button type="button" aria-pressed={sound} onClick={() => setSound(value => !value)}>{sound ? <Volume2 size={16}/> : <VolumeX size={16}/>}Clock sound {sound ? 'on' : 'off'}</button>
    </div>}
    <button type="button" className="wb-primary" aria-controls="webinar-offer" onClick={onOpen}>{offer.ctaLabel}</button>
  </section>;
}
