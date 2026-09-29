# Quick setup experiment v1
Existing setups keep guided onboarding and are excluded from the new experiment. Newly created setups receive a stable database-assigned 50/50 guided or quick variant, independently of the existing CTA-copy test.

Quick setup saves the business name with default Onyx branding, Sarah voice, Nationwide market, contract templates and buyer matching preferences, then displays the reveal and funding. Customize opens the existing guided controls. No additional paid lookup, outreach, image generation or payment starts from skipping steps. Generated logo choices remain available through customization; the default initials are not described as AI-generated artwork.

Both flows show the business identity, selected voice preview and branded unsigned document links before funding. Required billing consent is unchanged.

`icash_quick_setup_report()` is service-only. It compares visitors who have had at least 24 hours to convert, actual settled live purchases and revenue within 24 hours, and repeat buyers after a full seven-day observation period. It excludes legacy cohorts and test payments. No automatic winner selection or routing changes are made for this test. The denominator is initialized setup visitors, not every ad impression or landing-page request. Compare revenue per visitor alongside conversion before choosing a winner; repeat purchases are a retention proxy, not proof of deal success.

Verification: TypeScript, route-selection assertions, rollback database assignment/resume checks. Browser visual verification remains unavailable in this environment.
