/** Live telephony defaults. Not active until the outbound dispatcher is connected. */
export const liveVoiceCallPolicy = {
  targetDurationSeconds: 10 * 60,
  hardLimitSeconds: 15 * 60,
  speculativeGeneration: false,
  reserveCreditsBeforeDial: true,
  allowBursting: false,
} as const;
// The private acceptance test keeps its separate 180-second cap and access allowance.
// Live dispatch must apply the hard stop to both the voice agent and carrier call,
// reserve the configured customer charge for its allowed duration, and reconcile
// actual provider usage. A dropped browser/stream must not leave a billable call open.
