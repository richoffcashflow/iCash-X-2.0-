export const workspaceAcknowledgmentVersion='workspace-2026-10-15.1';
export const workspaceAcknowledgmentTitle='Before you use iCash X';
export const workspaceAcknowledgmentSections=[
 {title:'Understand the risk',text:'Results are not guaranteed. You may lose all money spent on software or a transaction. AI, estimates and documents can contain errors; verify them before acting.'},
 {title:'You are responsible for your deals',text:'You are responsible for due diligence, contracts, required licenses and applicable laws. iCash X provides software and education, not legal, financial, tax, brokerage or title advice. Consult qualified legal, financial and closing professionals.'},
 {title:'Independent parties',text:'Buyers, sellers and title companies act independently. To the extent permitted by law, iCash X is not responsible for their acts, disputes or defaults, or your transaction losses.'},
 {title:'All sales are final',text:'Software subscriptions, VIP upgrades and work credits are non-refundable except as required by law. Cancellation stops future renewals. Prior purchases retain their accepted terms. Mandatory consumer rights, including billing-error dispute rights, are not waived.'},
] as const;
export const workspaceAcknowledgmentConsent='I have read and agree to this acknowledgment. By selecting “I agree & open workspace,” I electronically accept it.';
export const workspaceAcknowledgmentDocument=[workspaceAcknowledgmentTitle,`Version: ${workspaceAcknowledgmentVersion}`,...workspaceAcknowledgmentSections.map(s=>`${s.title}\n${s.text}`),workspaceAcknowledgmentConsent,'Full costs and disclosures: https://www.geticashx.com/costs-and-disclosures'].join('\n\n');
