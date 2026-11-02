# Market

The Market is built on pluggable integrations. Read `docs/market-integrations.md` before changing anything here or adding a store.

- Adding a store means adding an integration in `integrations/<id>.ts` that implements `MarketIntegration` from `sdk.ts`, registered in `INTEGRATIONS` in `host.ts`. Nothing else should change.
- Integrations import only from `#/lib/market/sdk` and fetch only through `ctx.fetch`.
- Store-specific code lives only in its integration. Never branch on an integration or source id in `host.ts`, `merge.ts`, `src/lib/market-functions.ts` or the Market UI.
- If an integration needs something the contract lacks, extend `sdk.ts` generically (an optional field or method the host and UI handle for every source), update the docs, and bump `apiVersion` if it breaks existing integrations.
