# Tyrum

Container-native personal AI assistant platform focusing on proactive planning, strong guardrails, and explainable automation. This repository houses product strategy, process, and (soon) the services that power the assistant.

## Overview
- **Vision:** Deliver a chat/voice-native personal assistant that handles execution end-to-end across web, mobile, CLI, and structured APIs while keeping the backend invisible to the user.
- **Differentiators:**
  - No hard-coded skills; autonomy emerges from learned memory and generic executors.
  - Proactive nudges with external policy enforcement for spending, PII, and explainability.
  - Generic execution surfaces first, with opportunistic structured integrations (MCP/OpenAPI/GraphQL).
  - Every action remains auditable, reproducible, and backed by minimal constitutional rules.
- Full product concept, architecture diagrams, and appendices live in `docs/product_concept_v1.md`.

## Initial Technology Stack
- **Language & Runtime:** Rust 2024 (`tokio`, `axum`) for planner, policy gate, memory, and executors control planes.
- **Frontend:** Next.js 15.5 with React 19.2 (Server Components/Actions) for admin console, onboarding, and marketing surfaces.
- **Data & Storage:** PostgreSQL 16 with `pgvector` for structured + vector workloads, Redis 7 for session/cache, NATS JetStream for events/jobs.
- **LLM Runtime:** Containerized vLLM behind an internal gateway with multi-model routing and token accounting.
- **Container Orchestration:** Docker/BuildKit for local builds, Kubernetes + Helm for staging/production deploys.
- **Infra as Code:** Terraform for cloud resources, Helm charts for workloads, GitHub Actions for CI (Rust, web, IaC, container smoke tests, security baseline).
- **Observability:** OpenTelemetry instrumentation feeding Prometheus, Grafana, Tempo, and Loki; audit evidence persisted to S3-compatible storage.

## Roadmap Snapshot
Milestones are cumulative; see `docs/product_concept_v1.md` for full details.
- **M0 – Foundations & Guardrails:** Containerized dev environment, repo governance, CI/security workflows, planner/policy skeletons, memory schema, landing/portal shells, Terraform/Helm baseline.
- **M1 – Telegram MVP:** End-to-end planner with policy checks, discovery pipeline, generic executors, wallet integration, watchers, audit console, new-user onboarding funnel.
- **M2 – Reliability & Capability Memory:** Drift handling, capability memory reuse, cost controls, replay sandbox, production-readiness for Rust/Web services.
- **M3 – Persona & Voice:** Persona editor, onboarding calibration, voice support, explainability in audio responses.
- **M4 – Structured Integrations & MCP:** MCP discovery, schema caches, per-vendor capability memories.
- **M5 – Portal, Privacy & Admin:** Expanded portal (account controls, redaction), audit replay, quotas, compliance (KYC/AML), secrets management.
- **M6 – Multichannel & GA:** Additional messaging/voice channels, decision queues, branding/marketing site, GA checklist.

M0 tasks are broken into single-day issues (1 developer each) and tracked in GitHub Issues (`Ready` column onwards) following the working agreements below.

## Way of Working
- **Definition of Ready / Done:** See `docs/working_agreements.md` for detailed criteria. No issue enters development without clear acceptance checks, dependencies, and environment readiness; nothing is Done without tests, documentation, observability, and review.
- **Issue Lifecycle:** All work lives in GitHub Issues with acceptance criteria; the Tyrum project board tracks Backlog → Ready → In Progress → Review → Done. Blocked items must note dependencies.
- **PR Expectations:** One issue per PR, acceptance criteria duplicated in the description, automated checks and manual validations logged before review.
- **Continuous Improvement:** Retrospectives update the working agreements; deviations are documented with a plan to realign.

## Repository Structure
- `docs/` – Product concept (`product_concept_v1.md`), working agreements, and future architecture references.
- `AGENTS.md` – High-level repository guidance: planned directory layout, build/test commands, coding style, and security tips.
- Future directories:
  - `services/` – Rust workspaces for planner, policy gate, executors, memory.
  - `web/` – Next.js/React portal and marketing site.
  - `infra/` – Terraform, Docker Compose, Kubernetes manifests/Helm charts.
  - `shared/` – Interface contracts (OpenAPI, protobuf, policy schemas).

## Getting Started
1. **Read the concept:** Start with `docs/product_concept_v1.md` to understand goals, architecture, and milestones.
2. **Review the working agreements:** `docs/working_agreements.md` defines Definition of Ready, Definition of Done, and acceptance-criteria expectations.
3. **Review contributor workflow:** `CONTRIBUTING.md` covers the dev container setup, required environment files, and smoke tests expected before PRs.
4. **Set up tooling:** Install Docker, Rust 1.78+, Node 24+ (with npm 10+), and Terraform 1.6+. Local development will rely on `docker compose` once the services land.
5. **Clone & branch:** Fork/clone the repo, create branches as `<issue-number>-<slug>` (e.g., `issue-18-landing-page`).
6. **Follow CI workflows:** Run the same commands locally that GitHub Actions enforces (`cargo fmt/clippy/test`, `npm run lint/test/build`, Terraform/Compose/Kubernetes validations).
7. **Open PRs:** Reference the issue, list validation steps, attach screenshots/logs, ensure all Actions workflows succeed.

## Key Documents
- [Product Concept v1](docs/product_concept_v1.md)
- [Working Agreements (DoR/DoD)](docs/working_agreements.md)
- [Repository Guidelines](AGENTS.md)
- [Policy Check Service Skeleton](docs/policy_service.md)

## Contact & Support
- Discussion and planning live in GitHub Issues and the Tyrum project board.
- For urgent questions, mention the relevant owner in Issues/PRs; long-term decisions belong in `docs/` (ADRs) or in the working agreements.

## Local Container Development
1. Copy `config/local.env.example` to `config/local.env` if you want CLI access to the services from the host.
2. From the repo root run `docker compose -f infra/docker-compose.yml up --build` (or `cd infra && docker compose up --build`).
3. Once the stack has converged you should see:
   - Policy check service on http://localhost:8081 with `/healthz` returning `{ "status": "ok" }` and `POST /policy/check` evaluating spend/PII/legal guardrails
   - Rust API on http://localhost:8080 with `/healthz` returning `{ "status": "ok" }`
   - Next.js portal on http://localhost:3000
   - PostgreSQL on `localhost:5432` (`tyrum`/`tyrum_dev_password`)
   - Redis on `localhost:6379`
   - Mock LLM on http://localhost:8085/v1/completions echoing prompts
4. Tear the stack down with `docker compose -f infra/docker-compose.yml down --volumes` when finished.

The Docker Compose definition lives in `infra/docker-compose.yml` and mirrors how the future GitHub Actions container smoke tests will exercise the stack.
