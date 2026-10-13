// Static-compatible policy: Next hydration and existing inline styles remain allowed.
// Remote scripts/frames are restricted to the integrations actually used by the app.
export const contentSecurityPolicy=[
 "default-src 'self'",
 "script-src 'self' 'unsafe-inline' https://js.stripe.com https://maps.googleapis.com https://maps.gstatic.com https://connect.facebook.net",
 "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
 "img-src 'self' https: data: blob:",
 "font-src 'self' https://fonts.gstatic.com data:",
 "media-src 'self' https: blob:",
 "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.stripe.com https://*.googleapis.com https://*.gstatic.com https://*.facebook.com https://*.facebook.net https://*.twilio.com wss://*.twilio.com https://*.elevenlabs.io wss://*.elevenlabs.io",
 "frame-src 'self' https://*.stripe.com https://*.stripe.network https://app.docuseal.com",
 "worker-src 'self' blob:",
 "object-src 'none'",
 "base-uri 'self'",
 "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
 "frame-ancestors 'none'",
 'upgrade-insecure-requests',
].join('; ');
export const securityHeaders=[
 {key:'Content-Security-Policy',value:contentSecurityPolicy},
 {key:'X-Frame-Options',value:'DENY'},
 {key:'X-Content-Type-Options',value:'nosniff'},
 {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
 {key:'Permissions-Policy',value:'camera=(), microphone=(self), geolocation=(), payment=(self "https://js.stripe.com" "https://checkout.stripe.com" "https://hooks.stripe.com")'},
];
