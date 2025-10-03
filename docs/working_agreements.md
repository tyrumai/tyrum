# Tyrum Way of Working

## 1. Process Overview
- We track all work in GitHub Issues using the Tyrum project board. Every issue is scoped to roughly one developer day and includes links to the source of truth (e.g., `docs/product_concept_v1.md`).
- Issues move left-to-right through the following default columns: Backlog → Ready → In Progress → Review → Done. "Blocked" is available as a swim lane; blocked items must note the dependency in the issue description.
- Implementation happens in short-lived branches named `<issue-number>-<slug>` (for example `issue-12-memory-schema`). Each branch is merged through a pull request linked to its issue.
- All work executes inside containers. Local development uses `docker compose` and GitHub Actions mirrors the same images for CI and security workflows.
- GitHub Actions gates (`ci-rust`, `ci-web`, `ci-iac`, `ci-containers`, `security-baseline`) must be green before a pull request is eligible for review or merge.

## 2. Definition of Ready (DoR)
An issue is **Ready** when it meets all of the following:
- **Acceptance Criteria:** Clear, testable acceptance checks are written in bullet form. They cover functional behaviour, validation/telemetry, and any non-functional requirements (performance, security, accessibility).
- **Design References:** Links to design stubs, architecture diagrams, API contracts, or user flows are attached. For UX items, screenshots or Figma frames are referenced. For backend work, relevant sequence diagrams or schemas are cited.
- **Dependencies Identified:** Upstream work, external teams, secrets, or approvals are listed. Any unresolved dependency keeps the issue in Backlog.
- **Data & Test Inputs:** Required fixtures, sample payloads, or environment variables are defined and checked into the repo (sanitised) or stored in Vault with instructions.
- **Env Readiness:** Local and staging environments support the change (e.g., feature flags, Terraform resources, mock services). Missing infrastructure must have its own issue.
- **Security & Compliance:** Required policy checks, guardrails, or consent implications are documented. For data-touching work, retention/PII considerations are acknowledged.
- **Sizing Confirmation:** The assignee confirms the work fits the one-developer-day target. If not, the issue is split before moving to Ready.
- **Quality Signals:** Required automated checks (tests, linting, formatting) are known and documented; any new tooling updates are captured as sub-tasks.

## 3. Definition of Done (DoD)
An issue reaches **Done** only when all criteria below are satisfied:
- **Acceptance Criteria Met:** Every acceptance bullet in the issue is verified. Evidence is provided in the issue or PR (screenshots, logs, test output, links to dashboards).
- **Automated Checks Pass:** Relevant GitHub Actions workflows (`ci-rust`, `ci-web`, `ci-iac`, `ci-containers`, `security-baseline`) pass. For scheduled jobs, the latest successful run is referenced if manual trigger is impractical.
- **Tests & Coverage:** Unit, integration, and snapshot tests introduced/updated for the change run locally and in CI. New failure modes are covered by regression tests.
- **Manual QA (if required):** High-risk flows (auth, payments, policy enforcement) include manual test notes or screen recordings.
- **Documentation Updated:** README, `docs/`, API docs, and runbooks reflect new behaviour, flags, or operational steps. Changelog entries are added when externally visible.
- **Observability Wired:** Metrics, logs, and traces are instrumented or updated. Dashboards/alerts referenced in acceptance criteria are validated.
- **Security Compliance:** Secrets remain managed via approved vaults; dependency updates pass `cargo audit`, `pnpm audit`, `tfsec`, and `trivy`. Threat considerations are documented for data-sensitive work.
- **Backwards Compatibility:** Migration scripts are tested with up/down paths; fallback strategies are documented. Feature flags include rollback instructions.
- **Peer Review Completed:** At least one reviewer signs off. Review conversations are resolved or tracked for follow-up.
- **Merge & Cleanup:** Feature branches are merged to `main`, stale branches are removed, and the linked GitHub Issue is closed with a completion note.
- **Post-Merge Verification:** Production/staging deployment (if applicable) is verified, and alarms are monitored for one cycle.

## 4. Acceptance Criteria Guidelines
- Write acceptance criteria as bullet points beginning with observable outcomes (e.g., “Given… When… Then…” or “Script X outputs status Y”).
- Include success AND failure behaviours. Specify expected errors, policy escalations, and retry behaviour.
- Reference the exact command(s) or endpoints to validate the change (e.g., `cargo test -p planner`, `pnpm test --runInBand`, `terraform plan`).
- Quantify non-functional requirements (latency, throughput, Lighthouse score, token usage, cost ceiling).
- Attach verification artifacts (screenshots, trace IDs, log snippets) to issues or link to the relevant dashboard panel.
- Update or extend acceptance criteria whenever scope changes during implementation; the issue owner is responsible for keeping them current.

## 5. Pull Request Expectations
- Each PR references exactly one issue (unless performing shared refactors) and repeats the acceptance criteria in the PR description with checkboxes.
- PRs include testing notes outlining automated commands run locally and any manual validation performed.
- Reviewers verify that DoR assumptions were respected and that DoD requirements are met before approving.
- If new workflows, scripts, or dashboards were added, they are linked in the PR to help reviewers reproduce the results.

## 6. Continuous Improvement
- Retrospectives capture gaps in DoR/DoD or acceptance criteria. Adjust this document when the team evolves the process.
- Any deviation from the defined process must be explicitly called out in the issue/PR, along with a plan to realign or improve the working agreement.

