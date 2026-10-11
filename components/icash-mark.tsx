import styles from './icash-mark.module.css';

/** The same chrome X used by the workspace bot, scaled for each brand surface. */
export function IcashMark({className='',label}:{className?:string;label?:string}) {
 return <span className={`${styles.mark} ${className}`} role={label?'img':undefined} aria-label={label} aria-hidden={label?undefined:true}><span className={styles.glyph}>X</span></span>;
}
