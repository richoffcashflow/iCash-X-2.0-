import {Network} from 'lucide-react';
import styles from './buyer-network.module.css';

export function BuyerNetworkSummary({subtitle}:{subtitle:string}){
 return <summary><span className={styles.networkIcon}><Network size={20} aria-hidden="true"/></span><span>Buyer network<small>{subtitle}</small></span><span className={styles.vipLabel}>VIP</span></summary>;
}
