// Preview values only. Production packs and rates load from versioned admin records.
export const previewCreditPacks = [
  { amountCents: 2000, label: "$20", description: "Small top-up" },
  { amountCents: 10000, label: "$100", description: "Start working" },
  { amountCents: 25000, label: "$250", description: "More capacity" },
] as const;
