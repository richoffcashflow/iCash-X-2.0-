import {dealTermsSchema} from './deal-documents.ts';
import {renderOriginalContract} from './original-contracts.ts';

/** Owner course fixtures only. Uses the exact production forms and field placement. */
export function coursePreviewContracts(){
 const terms=dealTermsSchema.parse({seller:'Taylor Parker',buyer:'Sample Investor LLC',assignee:'Cedar Ridge Homes',address:'128 Sample Lane, Dallas, TX 75201',legalDescription:'FICTIONAL EXAMPLE — Lot 1, Sample Addition. Not a real legal description.',state:'TX',county:'Dallas',priceCents:9000000,assignmentFeeCents:1000000,assignmentDepositCents:200000,effectiveDate:'2026-10-14',closingDate:'2026-10-30',escrowAgent:'Example Title'});
 const sample=(kind:'purchase'|'assignment')=>renderOriginalContract(kind,terms).replace(/font-size:([0-9.]+)pt/g,(_match,size)=>`font-size:calc(100cqw * ${size} / 612)`).replace('</style>','.page{width:min(100vw,816px);height:auto;aspect-ratio:612 / 792;container-type:inline-size}.sample-notice{position:sticky;top:0;z-index:3;background:#111;color:#fff;text-align:center;padding:9px;font:700 12px Arial}.sample-watermark{position:absolute;top:43%;left:9%;width:82%;transform:rotate(-25deg);text-align:center;font:700 6cqw Arial;color:rgba(0,0,0,.13);pointer-events:none;z-index:2}@media print{.sample-notice{position:static}} </style>').replace('<body>','<body><div class="sample-notice">FICTIONAL COURSE EXAMPLE · NOT FOR SIGNATURE</div>').replace('<div class="page">','<div class="page"><div class="sample-watermark">SAMPLE — NOT FOR SIGNATURE</div>');
 return {purchase:sample('purchase'),assignment:sample('assignment')};
}
