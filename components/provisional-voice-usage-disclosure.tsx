import {provisionalVoiceUsageDisclosure} from '@/lib/provisional-voice-usage-disclosure';
import styles from './provisional-voice-usage-disclosure.module.css';

export function ProvisionalVoiceUsageDisclosure({pending,stale=false}:{pending?:boolean;stale?:boolean}){
 const message=provisionalVoiceUsageDisclosure(pending,stale);
 if(!message)return null;
 return <aside className={styles.notice} aria-label="Provisional call usage"><strong>Provisional call usage</strong><p>{message}</p></aside>;
}
