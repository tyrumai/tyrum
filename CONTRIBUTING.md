# Contributing to Tyrum

Thanks for helping build the Tyrum assistant platform. This document captures the day-zero workflow for contributors and complements the repository guidelines in `AGENTS.md` plus the working agreements in `docs/working_agreements.md`.

## 1. Getting Started
- Install Docker, Git, Node.js 24+, Rust 1.89+, Helm 3.12+, kubectl 1.30+, and Python 3.13+ on your host.
- Clone the repository and create branches as `<issue-number>-<slug>` (for example `issue-12-memory-schema`).
- Install the shared hooks with `pre-commit install` so every commit runs the same validations enforced in CI.

## 2. Dev Container Workflow
We ship a fully provisioned VS Code dev container under `.devcontainer/devcontainer.json`.

1. Install the **Dev Containers** VS Code extension (or `devcontainer` CLI).
2. Run **Dev Containers: Reopen in Container** from the command palette after opening the repo root.
3. The container installs Rust (with `rustfmt`/`clippy`), Node 24 with npm 11.6, Helm 3, kubectl, Docker CLI access, and bootstraps `pre-commit` hooks.
4. Use the mounted Docker socket to exercise `docker compose -f infra/docker-compose.yml up --build` without leaving the container.

## 3. Environment Configuration
Tyrum services expect explicit environment files so production secrets never land in git.

- **Rust services:** copy `config/local.env.example` to `config/local.env`, then adjust credentials for the Docker Compose stack.
- **Next.js portal:** create `web/.env.local` (or `.env.local` if working from the repo root) with the frontend-only variables you need. Do not commit these files.
- **Shared defaults:**
  - `POSTGRES_HOST=localhost`, `POSTGRES_USER=tyrum`, `POSTGRES_PASSWORD=tyrum_dev_password`, `POSTGRES_DB=tyrum_dev`
  - `REDIS_URL=redis://localhost:6379/0`, `NATS_URL=nats://127.0.0.1:4222`
  - `LLM_GATEWAY_URL`, `POLICY_GATE_URL`, and `MEMORY_API_URL` should point at the matching containers once they land.

## 4. Local Smoke Tests
Run these commands before opening a pull request. They mirror the required GitHub status checks and `pre-commit` hooks.

| Area | Command |
| --- | --- |
| Repository hygiene | `pre-commit run --all-files` |
| Rust workspace | `cargo fmt --all`, `cargo clippy --all-targets --all-features`, `cargo test --all --all-targets` |
| Web portal | `npm install` (first run) then `npm run lint` and `npm run test -- --watch=false` from the portal root |
| Infrastructure | `docker compose config`, `helm lint infra/helm/tyrum-core`, `helm template tyrum infra/helm/tyrum-core >/dev/null` |
| Containers | `docker compose -f infra/docker-compose.yml up --build` (ensure planner, executors, policy gate, and Postgres boot) |
| Security baseline | `cargo audit`, `npm audit --audit-level high`, `trivy config .` |

Document the commands you executed in your pull-request description, along with any manual verification (screenshots, logs, trace IDs) required by the Definition of Done.

## 5. Branch Protections & Reviews
Pull requests must reference their GitHub Issue, include the acceptance checklist, and pass all required checks:
- `ci-rust`, `ci-web`, `ci-iac`, `ci-containers`
- `security-baseline` (runs on a nightly schedule; failures block merges until resolved)
- At least one approving review, including CODEOWNER sign-off for touched paths
- Branches must be up to date with `main` and use fast-forward or merge commits that preserve history

Follow the 72-character imperative commit style (for example, `Add policy gate scaffold`). Reference related issues in the body and call out validation evidence so reviewers can reproduce the results.
