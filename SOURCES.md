# Implementation references

Anthropic Messages endpoint and authentication: https://platform.claude.com/docs/en/api/overview (read 2026-10-23). POST https://api.anthropic.com/v1/messages with x-api-key, anthropic-version, content-type. Current guidance supports the legacy 2023-06-01 API version used by the example; version is configurable. No sampling parameters are sent.

Messages request and text content response shape: https://platform.claude.com/docs/en/build-with-claude/working-with-messages (read 2026-10-23). The adapter safely parses text blocks as JSON and treats errors/invalid output as deterministic fallback.

Asset discovery: image search 'dumbbells gym dark equipment close up'. Photo result 8 (Pexels 'Close-Up Photo of Two Heavy Dumbbells') is an equipment photo selected for the example workout card; copied into public/equipment.jpg. CDN search source: https://files.manuscdn.com/search-media/310519664040458314/oPc2WdGWBQdBUUt5RIu41R/Rj4PhVTsQo5KS7wdqHApCT.jpeg. No clinical or fitness-efficacy claims are sourced from this image.

Lemon Squeezy checkout creation: https://docs.lemonsqueezy.com/api/checkouts/create-checkout (read 2026-10-24). The adapter creates a JSON:API checkout for a configured store and variant, passes the Rebound user ID via checkout_data.custom, and uses the returned hosted checkout URL.

Lemon Squeezy custom data: https://docs.lemonsqueezy.com/help/checkout/passing-custom-data (read 2026-10-24). The user identifier is kept minimal and is recovered from meta.custom_data in subscription/order webhooks.

Lemon Squeezy webhook signatures and Next.js example: https://docs.lemonsqueezy.com/help/webhooks/signing-requests and https://docs.lemonsqueezy.com/guides/tutorials/webhooks-nextjs (read 2026-10-24). The route verifies the raw request body with SHA-256 HMAC against X-Signature before parsing or persisting events. No provider secret is committed.
