/** Provider turn settings, not a per-call override. An existing reviewed agent
 * needs a separately verified version/fingerprint before this can go live.
 * ElevenLabs uses -1 to disable its automatic per-generation filler timer. */
export function sellerVoiceTurnConfig(current:Record<string,unknown>={}){
 const previous=current.soft_timeout_config;
 const soft=previous&&typeof previous==='object'&&!Array.isArray(previous)?previous as Record<string,unknown>:{};
 return {...current,turn_eagerness:'normal',turn_timeout:10,soft_timeout_config:{...soft,timeout_seconds:-1}};
}

export function sellerVoiceTurnConfigMatches(current:Record<string,unknown>):boolean{
 const soft=current.soft_timeout_config;
 return current.turn_eagerness==='normal'&&current.turn_timeout===10&&soft!==null&&typeof soft==='object'&&!Array.isArray(soft)&&(soft as Record<string,unknown>).timeout_seconds===-1;
}
