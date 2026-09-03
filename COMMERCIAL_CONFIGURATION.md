# Cortex commercial configuration

Cortex plan identity and entitlements are product code. Sell prices are deployment-owned commercial configuration.

Production requires `CORTEX_COMMERCIAL_CATALOG_JSON`. Amounts are integer minor currency units so commercial changes do not require source-code edits and floating-point money is avoided.

Example shape only:

```json
{
  "currency": "USD",
  "plans": {
    "pro": { "monthly": 7900, "annual": 79000 },
    "team": { "monthly": 14900, "annual": 149000 },
    "enterprise": { "annualMinimum": 5000000 }
  }
}
```

The numbers above preserve the repository's former source-code assumptions for migration/testing purposes; they are not a recommendation for market pricing. Production must intentionally configure the catalog. Stripe Price IDs remain collection mappings (`STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`, `STRIPE_PRICE_TEAM_MONTHLY`, `STRIPE_PRICE_TEAM_ANNUAL`) and must correspond to the commercial catalog used by the product.

The runtime fails closed when the commercial catalog is absent or malformed. Entitlements are not derived from Stripe display metadata; they remain Cortex-owned and are resolved from the durable subscription state.
