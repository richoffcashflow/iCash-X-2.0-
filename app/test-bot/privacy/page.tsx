import Link from 'next/link';
import {botDemoConsentText,botDemoSharingText} from '@/lib/bot-demo';
export const metadata={title:'Demo Privacy & Contact Choices | iCash X',robots:{index:false,follow:false}};
export default function DemoPrivacy(){return <main className="legal-page"><div className="legal-content">
 <Link href="/test-bot">← Back to iCash X</Link><h1>Demo privacy & contact choices</h1>
 <p>{botDemoSharingText}</p><h2>What you share</h2><p>We save your name, property address, phone number, timezone, submission time, and the contact agreement you accepted. A protected browser reference lets you check progress and prevents duplicate submissions.</p>
 <h2>How the demo works</h2><p>The presenting account uses iCash X to research the property and manage the conversation. Property research and communication providers process the information needed to run those features. Calls, texts, replies, and related property activity may appear in the presenting account’s workspace.</p>
 <h2>Your contact agreement</h2><p>{botDemoConsentText}</p><h2>Your choices</h2><p>Use only a number you have permission to provide. You can reply STOP to texts or tell the caller you do not want further contact. Contact iCash X through <Link href="/support">Support</Link> for help with your information.</p>
 </div></main>;}
