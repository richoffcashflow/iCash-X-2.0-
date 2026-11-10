/** Only a verified atomic database refusal is a known new-intent rate limit. */
export class BotDemoRateLimitError extends Error {
 readonly status=429;
 readonly retryAfter=3600;
 constructor(){super('Too many new demos. Please wait before starting another one.');this.name='BotDemoRateLimitError';}
}
