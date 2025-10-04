# Landing Page Lighthouse Baseline

This document captures the repeatable workflow for validating the `/` route meets the M0 performance and accessibility guardrails.

## Prerequisites
- Node.js v24.9.0 (other 20+ LTS releases are expected to work).
- Dependencies installed: `cd web && npm install`.
- Lighthouse CLI tooling is bundled via `@lhci/cli`; GitHub Actions also invokes `npm run lighthouse:ci` as part of `ci-web`.

## Test Procedure
1. `cd web`
2. Build the production bundle: `npm run build`
3. Run the CI-equivalent audit locally with `npm run lighthouse:ci` (spawns Next.js in production mode twice to capture mobile and desktop runs).
4. Raw Lighthouse JSON dumps land under `../artifacts/lighthouse-{mobile,desktop}` for further inspection.

> Tip: create the `artifacts/` directory (gitignored) beforehand so Lighthouse can persist the JSON reports for auditing.

## 2025-10-03 Results
| Profile  | Performance | Accessibility | Best Practices | SEO |
|----------|-------------|----------------|----------------|-----|
| Mobile   | 100         | 100            | 100            | 100 |
| Desktop  | 100         | 100            | 100            | 100 |

### Observations
- Adding the dedicated `app/icon.svg` removes the previous `favicon.ico` 404 console error, restoring the Best Practices score to 100.
- Introducing an accessible heading hierarchy (hidden `h2` for the value props section) resolves the `heading-order` warning and raises Accessibility to 100.

Re-run this checklist whenever the landing page changes materially; scores must remain ≥90 per the product concept.
