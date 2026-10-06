'use client';

import Script from 'next/script';
import {useEffect, useRef, useState, type KeyboardEvent} from 'react';
import {MapPin} from 'lucide-react';
import {createAddressSearch, type AddressPrediction, type PlacesLibrary} from '@/lib/address-autocomplete';

const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
type MapsWindow = Window & {google?: {maps: {importLibrary(name: string): Promise<PlacesLibrary>}}};

export function SellerAddressInput({value, onChange}: {value: string; onChange: (value: string) => void}) {
  const [activated, setActivated] = useState(false);
  const [focused, setFocused] = useState(false);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressPrediction[]>([]);
  const [active, setActive] = useState(-1);
  const [selecting, setSelecting] = useState(false);
  const search = useRef<ReturnType<typeof createAddressSearch> | null>(null);
  const generation = useRef(0);
  const selected = useRef('');
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const lookup = useRef<HTMLDivElement>(null);
  const expanded = focused && suggestions.length > 0;

  useEffect(() => {mounted.current = true; return () => {mounted.current = false; generation.current++;};}, []);

  useEffect(() => {
    if (!focused) return;
    // A touch can blur the input before its click reaches a suggestion.
    // Dismiss on an actual outside press instead; leave scrolling untouched.
    function outsidePress(event: PointerEvent) {
      if (!(event.target instanceof Node) || lookup.current?.contains(event.target)) return;
      generation.current++;
      setFocused(false);
      setSuggestions([]);
      setActive(-1);
    }
    document.addEventListener('pointerdown', outsidePress, true);
    return () => document.removeEventListener('pointerdown', outsidePress, true);
  }, [focused]);

  async function initialize() {
    try {
      const maps = (window as MapsWindow).google?.maps;
      if (!maps) throw new Error('Maps unavailable');
      const places = await maps.importLibrary('places');
      if (!mounted.current) return;
      search.current = createAddressSearch(places);
      setReady(true);
    } catch {if (mounted.current) setUnavailable(true);}
  }

  useEffect(() => {
    const current = ++generation.current;
    if (!ready || !focused || value.trim().length < 3 || value === selected.current) return;
    const timer = setTimeout(async () => {
      try {
        const results = await search.current!.search(value);
        if (current !== generation.current || !mounted.current) return;
        setSuggestions(results);
        setActive(-1);
        setUnavailable(false);
      } catch {
        if (current !== generation.current || !mounted.current) return;
        setSuggestions([]);
        setUnavailable(true);
      }
    }, 300);
    return () => {clearTimeout(timer); generation.current++;};
  }, [value, focused, ready]);

  async function choose(prediction: AddressPrediction) {
    const label = prediction.text.toString();
    selected.current = label;
    generation.current++;
    setSuggestions([]);
    setActive(-1);
    setSelecting(true);
    onChange(label);
    input.current?.focus();
    // The effect for the changed input runs before this asynchronous result.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const address = await Promise.race([
        search.current!.select(prediction),
        new Promise<string>(resolve => {timeout = setTimeout(() => resolve(label), 5000);}),
      ]);
      if (mounted.current && selected.current === label) {
        selected.current = address;
        onChange(address);
      }
    } catch { /* The selected suggestion is still a usable, editable address. */ }
    finally {clearTimeout(timeout); if (mounted.current) setSelecting(false);}
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {generation.current++; setSuggestions([]); setActive(-1);}
    if (!expanded) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(index => event.key === 'ArrowDown' ? (index + 1) % suggestions.length : (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      void choose(suggestions[active]);
    }
  }

  return <>
    {apiKey && activated && <Script id="homeoffer-google-maps" src={`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&v=weekly`} onReady={() => {void initialize();}} onError={() => setUnavailable(true)}/>}
    <div ref={lookup} className="seller-address-lookup" onBlur={event => {
      // Keep the list mounted while focus moves to a suggestion, including
      // mobile browsers that report a null relatedTarget during a tap.
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
        generation.current++; setFocused(false); setSuggestions([]); setActive(-1);
      }
    }}>
      <label className="seller-address-bar" htmlFor="seller-address"><MapPin size={22} aria-hidden="true"/>
        <input ref={input} id="seller-address" name="street-address" type="text" inputMode="text" autoCorrect="off" spellCheck={false} autoComplete={apiKey ? 'off' : 'street-address'} enterKeyHint="next" required minLength={8} maxLength={300} value={value} aria-busy={selecting}
          role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? 'seller-address-options' : undefined} aria-activedescendant={expanded && active >= 0 ? `seller-address-option-${active}` : undefined} aria-describedby="seller-address-hint"
          onFocus={() => {setActivated(true); setFocused(true);}}
          onChange={event => {generation.current++; selected.current = ''; setSuggestions([]); setActive(-1); onChange(event.target.value);}}
          onKeyDown={keyDown} placeholder="Enter your home address"/>
      </label>
      {expanded && <div className="seller-address-dropdown">
        <ul id="seller-address-options" role="listbox" aria-label="Matching addresses">
          {suggestions.map((prediction, index) => <li key={prediction.placeId} role="presentation"><button type="button" id={`seller-address-option-${index}`} role="option" aria-selected={index === active} tabIndex={-1}
            onClick={() => void choose(prediction)}><MapPin size={16} aria-hidden="true"/><span>{prediction.text.toString()}</span></button></li>)}
        </ul>
        <div className="seller-google-attribution"><img src="/google-maps-attribution.svg" alt="Google Maps" height={16}/></div>
      </div>}
    </div>
    <p id="seller-address-hint" className="seller-address-hint" role="status">{unavailable ? 'Suggestions unavailable. Enter your full address.' : 'Include your city, state and ZIP.'}</p>
  </>;
}
