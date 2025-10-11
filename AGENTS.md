# Repository Guidelines

## Project Structure & Module Organization
- `docs/` houses product concepts and architectural references; treat it as the source of truth when scoping new work.
- As services land, place Rust workspaces under `services/` (one crate per bounded context), the admin portal under `web/`, and infrastructure manifests under `infra/` (Docker Compose for local, Kubernetes for prod mirrors).
- Keep shared interface contracts (protobuf/OpenAPI schemas, policy definitions) in `shared/` so both planners and executors can import them without duplication.

## Build, Test, and Development Commands
- Rust control-plane services: `cargo check` for fast sanity, `cargo fmt --all` and `cargo clippy --all-targets --all-features` before commits, `cargo test --all --all-targets` for unit + integration coverage.
- Next.js console: `npm install` once, then `npm run dev` for local development, `npm run lint` for ESLint/Prettier, and `npm run test` for component and hook specs.
- Container workflows: `docker compose up --build` should stand up planner, executors, policy gate, and Postgres; add new services to `docker-compose.yml` with sane defaults.
- Automation: install `pre-commit` and run `pre-commit install` so shared hooks enforce linting for Rust, Next.js, GitHub Actions, Compose, Kubernetes, and Helm assets before every commit.

## Coding Style & Naming Conventions
- Rust: rely on `rustfmt`; modules and files use `snake_case`, types `PascalCase`, constants `SCREAMING_SNAKE_CASE`. Keep functions under 80 columns when practical and favour small, testable units.
- TypeScript/React: default to 2-space indentation, `camelCase` for variables/hooks, `PascalCase` for components, and colocate UI state machines alongside components in `*.machine.ts` files.
- Document non-obvious planner policies or executor quirks inline with focused comments; prefer ADRs in `docs/` for larger decisions.

## Testing Guidelines
- Target >80% coverage for policy-critical Rust crates; place slow integration suites in `services/<crate>/tests` and tag them with `#[ignore]` if they require external systems.
- Frontend stories and tests live beside components (`Component.test.tsx`, `Component.stories.tsx`); run `npm run test -- --watch=false` in CI to keep deterministic output.
- Before opening a PR, run the full compose stack once and verify audit logging remains readable and complete per the guardrails in the product concept.

## Commit & Pull Request Guidelines
- Follow the existing history: a single descriptive sentence in the imperative/present, ≤72 characters when possible (e.g., "Extend policy gate to cover spend caps").
- Reference related issues in the body, list validation commands executed, and call out risk areas (consent flows, spend limits, PII handling).
- PRs updating planner or executors should include a short playbook or Loom link demonstrating end-to-end behaviour; UI changes need screenshots or recordings of key states.

## Security & Configuration Tips
- Never commit secrets; use `.env.local` for Next.js and `config/local.env` (gitignored) for Rust services. Mirror production secrets via the secret manager, not plaintext files.
- Guardrail changes must document consent, spend, and audit implications in `docs/` and reference the external policy gate to keep enforcement transparent.
- When adding new executors or discovery probes, ensure all outbound network domains are enumerated for review and rate-limited at the edge.
