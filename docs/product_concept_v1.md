# Personal AI Assistant — Product Concept v1

**Date:** 2025‑10‑03
**Owner:** Ron Hernaus
**Working Title:** (TBD)

---

## 1) Summary
A chat/voice‑native Personal Assistant (PA) that hides all backend complexity. Users interact only via messaging (Telegram first), voice, or short video. The PA proactively manages life and work by reasoning over goals, learning preferences from interactions (not hard‑coded skills), and acting through **generic execution surfaces** (Web, Android emulator, CLI/VM, generic HTTP). When available, it **opportunistically discovers structured interfaces** (MCP, OpenAPI, GraphQL) to increase reliability—without exposing any of this to the user.

A minimal set of **constitutional guardrails** (spend/PII/legal/explainability) is enforced by an external policy gate; everything else is learned from the user or asked at runtime and persisted in memory. Every action is auditable, reproducible, and explainable.

---

## 2) Differentiation
- **No hard‑coded “skills.”** The system composes actions from generic primitives and learned memory.
- **Proactive by design.** Watches events and nudges/acts within user‑defined (and learned) boundaries.
- **Invisible backend.** Users never see “flows” or connectors—only outcomes and short confirmations.
- **Learned autonomy.** The PA quickly adapts consent, tone, voice, and spending behavior per user.

---

## 3) Core Principles
1. **Guardrails are wide but real.** A tiny constitution enforced *outside* the LLM:
   - No asset movement/commitments without recent consent or within explicit limits.
   - No new‑party PII sharing without consent.
   - Respect legal/channel rules.
   - Every action must be explainable in a human‑readable audit trail.
2. **Generic executors first.** Prefer Web, Android, CLI/VM, and generic HTTP; auto‑prefer structured APIs when discovered.
3. **Memory over code.** Preferences, flows, selectors, budgets, and vendor quirks are **remembered**, not coded.
4. **Ask when unsure.** Low‑confidence autonomy → concise confirmation; teach‑back → persist preference.
5. **Tool minimization.** The model sees only a small, retrieved set of affordances relevant to the goal (no huge tool lists in prompts).

---

## 4) User Experience
- **Interfaces:** Telegram (MVP), then WhatsApp Business/iMessage (subject to policy), voice calls (SIP/WebRTC), voice notes.
- **Modality:** text, voice, and short video prompts; PA replies in the preferred persona/voice.
- **Proactivity:** Calendar conflicts, travel changes, bills due, delivery slippage, follow‑up nudges, etc.
- **Consent UX:** One‑tap approvals with clear cost/impact; “ask once per vendor” and budget caps supported; controls mirror the live activity feed so users can pause or escalate any plan.
- **Live activity feed:** Real-time timeline showing planner intents, policy checks, and executions with pause/hold controls for each step.
- **Editable permissions:** User-facing console to adjust watchers, spend caps, data scopes, and executor access at any time.
- **Rapid undo:** Single-tap reversal window for recent actions, triggering automated rollback instructions or cancellations.
- **Explainability:** “I ordered from Place X because no public API was found; last two flows succeeded; total €27, 3DS approved at 18:12.”

---

## 5) Architecture (high level)
```mermaid
flowchart LR
  subgraph Channels
    TG[Telegram]
    EM[Email]
    VO[Voice]
  end
  TG --> ING
  EM --> ING
  VO --> ING

  subgraph Ingestion & Normalization
    ING[Ingress: normalize to Message/Thread]
  end

  ING --> ORC

  subgraph Core
    ORC[Planner/Orchestrator]
    DIR[Tool Directory]
    POL[Policy Gate]
    MEM[Memory Layer]
    OBS[Observability/Audit]
  end

  ORC <--> DIR
  ORC <--> MEM
  ORC --> POL
  POL --> ORC
  ORC --> EXE

  subgraph Execution Surfaces
    EXE[Generic Executors]
    WEB[Web (Playwright)]
    AND[Android Emulator]
    CLI[CLI/VM]
    HTTP[Generic HTTP]
  end
  EXE --> WEB
  EXE --> AND
  EXE --> CLI
  EXE --> HTTP

  subgraph Discovery
    MCP[MCP Probe]
    API[OpenAPI/GraphQL Discovery]
  end
  DIR <-- Probe results --> MCP
  DIR <-- Probe results --> API

  subgraph Events
    BUS[Event Bus]
    WAT[Watcher Store]
  end
  BUS --> ORC
  ORC <--> WAT
  ORC --> OBS
```

**Planner/Orchestrator:** LLM‑guided planning that emits small, neutral **action primitives** (see Appendix A). Plans are checked by Policy, executed by generic surfaces, and logged in detail.
**Tool Directory:** Returns only the **top‑k** relevant affordances (e.g., “Web”, “Android”, a discovered OpenAPI) to avoid prompt bloat.
**Discovery:** First attempt **MCP**, then structured API hints, else fall back to generic Web/Android/CLI.
**Events/Watchers:** Generic events + predicates + reactions (no fixed watcher types).

### Technology Stack (initial)
- **Containers first:** Build OCI images with Docker/BuildKit; local orchestration via `docker compose`, production scheduling on Kubernetes for isolation and autoscaling.
- **Core services:** Rust 2024 (async via `tokio` + `axum`) for planner/orchestrator, policy gate, memory, and executor control planes; sidecars for policy/audit enforcement share the same toolchain.
- **Web portal:** Next.js 15.5+ + React 19.2 with Server Components/Actions for the admin console and live activity feed; Tailwind or design system TBD.
- **Data tier:** PostgreSQL 16 with `pgvector` for embeddings + RLS policies; hydrated via Rust and ingestion pipelines.
- **Eventing & jobs:** NATS JetStream for the event bus/watchers, with Rust consumers handling parallel execution; lightweight cron via Kubernetes Jobs.
- **Caching & rate limits:** Redis 7 (cluster mode) for low-latency session state, policy throttles, and short-lived planner memory.
- **LLM runtime:** Model gateway (see `docs/infra/model_gateway.md`) fronts local vLLM deployments and upstream frontier APIs, applying routing policy, token accounting, and auth.
- **Observability:** OpenTelemetry instrumentation exported to Prometheus/Grafana + Tempo/Loki stack; audit evidence streamed to S3-compatible storage.
- **Infra as code:** Terraform + Helm charts managing cluster bootstrap, secrets, runners, and CD pipelines.

### Model Gateway (multi-backend LLM access)
- The gateway exposes a single OpenAI-compatible surface to internal services and consults configuration to decide whether to route a call to local vLLM models or a frontier provider (OpenAI, OpenRouter, etc.).
- Each model entry carries auth profile, capability flags, token/cost guardrails, and target endpoint; unknown models fail closed.
- Telemetry and audit logs record the chosen backend, token usage, latency, and any policy violations.
- Streaming responses (`stream: true` or upstream SSE) are proxied without buffering so downstream services (e.g., voice) can act on partial completions immediately.
- Detailed configuration and next steps live in `docs/infra/model_gateway.md`.

---

## 6) Capability Discovery (no skills list)
**Order:** `try_mcp() → try_structured_api() → try_generic_http() → web/android/cli`
- **MCP:** probe user‑linked endpoints / local hub; treat as untrusted until scopes are granted; cache success.
- **Structured APIs:** look for OpenAPI/GraphQL/CalDAV/IMAP via headers, sitemaps, manifests, `.well-known` hints.
- **Generic HTTP:** authenticated basic calls if discovered (schemas generated on the fly).
- **Automation fallback:** robust Web/App automation using accessibility roles and explicit postconditions.

All successful paths are stored as **capability memory** (what worked, known costs, selectors, anti‑bot quirks) and reused.

---

## 7) Planner: neutral plan/trace (not domain skills)
Use a minimal set of **universal action primitives** to enable auditability, retries, and consents without introducing domain APIs.

**Primitives (examples):**
- `Research(query|url) → observations`
- `Decide(options|policy|memory) → choice`
- `Web(action[, postcondition])`
- `Android(action[, postcondition])`
- `CLI(action[, postcondition])`
- `HTTP(request[, postcondition])`
- `Message(send|draft)`
- `Pay(amount, merchant, instrument, postcondition)`
- `Store(memory_update)`
- `Watch(event_source, predicate, reaction_plan)`
- `Confirm(summary, cost, risk)`

**Postconditions are mandatory** on state‑changing steps to avoid silent failure.

### Planner request/response contract
Planner clients exchange the shared `PlanRequest` and `PlanResponse` types from `tyrum-shared::planner`
to keep policy, planner, and API services aligned on envelopes and error handling. Optional hints such as
`locale` or `timezone` may be omitted when the caller has no preference.

**Request Example (`PlanRequest`):**
```json
{
  "request_id": "req-8f5080c4",
  "subject_id": "user-d2a7",
  "trigger": {
    "thread": {
      "id": "219901",
      "kind": "private",
      "title": null,
      "username": "alex",
      "pii_fields": ["thread_username"]
    },
    "message": {
      "id": "77881",
      "thread_id": "219901",
      "source": "telegram",
      "content": {
        "kind": "text",
        "text": "Can you book a tasting at EspressoExpress for next Friday?"
      },
      "sender": {
        "id": "8722",
        "is_bot": false,
        "first_name": "Alex",
        "last_name": null,
        "username": "alex",
        "language_code": "en"
      },
      "timestamp": "2025-10-05T15:59:42Z",
      "edited_timestamp": null,
      "pii_fields": ["message_text", "sender_first_name", "sender_username"]
    }
  },
  "locale": "en-US",
  "timezone": "America/Los_Angeles",
  "tags": ["telegram", "pilot"]
}
```

**Response Example — Success (`PlanResponse`):**
```json
{
  "plan_id": "plan-e0c44e4f",
  "request_id": "req-8f5080c4",
  "created_at": "2025-10-05T16:31:09Z",
  "trace_id": "trace-bee4",
  "status": "success",
  "steps": [
    {
      "type": "Research",
      "args": {
        "intent": "look_up_availability",
        "query": "EspressoExpress Friday tastings"
      }
    },
    {
      "type": "Message",
      "args": {
        "channel": "email",
        "recipient": "reservations@espressoexpress.example",
        "body": "Please confirm a tasting for Friday at 18:00."
      },
      "postcondition": {
        "status": "delivered"
      }
    }
  ],
  "summary": {
    "synopsis": "Gather options and send a confirmation email"
  }
}
```

**Response Example — Escalate (`PlanResponse`):**
```json
{
  "plan_id": "plan-7c52d8a1",
  "request_id": "req-8f5080c4",
  "created_at": "2025-10-05T16:31:09Z",
  "status": "escalate",
  "escalation": {
    "step_index": 1,
    "action": {
      "type": "Confirm",
      "args": {
        "prompt": "Approve €85 tasting fee at EspressoExpress?",
        "context": {
          "merchant": "EspressoExpress",
          "amount": {
            "currency": "EUR",
            "value": 85
          }
        }
      }
    },
    "rationale": "Spend cap requires explicit approval",
    "expires_at": "2025-10-06T12:00:00Z"
  }
}
```

**Response Example — Failure (`PlanResponse`):**
```json
{
  "plan_id": "plan-36d940c7",
  "request_id": "req-8f5080c4",
  "created_at": "2025-10-05T16:31:09Z",
  "status": "failure",
  "error": {
    "code": "policy_denied",
    "message": "Payment exceeds approved budget",
    "detail": "Wallet tyrum: monthly dining cap of €200 would be exceeded",
    "retryable": false
  }
}
```

---

## 8) Memory System
- **Facts Store:** canonical truths (names, addresses, IDs, vendor prefs, budgets).
- **Episodic Store:** messages, attempts, outcomes; event‑sourced.
- **Vector Store:** semantic recall for unstructured content (docs/threads).
- **Capability Memory:** selectors, flows, success/failure patterns per site/app.
- **Policy/Autonomy Model (PAM):** learned consents, quiet hours, escalation style, spending behavior with confidence scores; if low → ask.
- **Persona & Voice Profile (PVP):** tone, verbosity, initiative, emoji tolerance, language rules, voice params (pace/pitch/warmth), and pronunciation dictionary. (See Appendix B.)

### Capability memory schema & usage
- Table: `capability_memories` (primary key `id`) keyed by the unique tuple
  `(subject_id, capability_type, capability_identifier, executor_kind)`. Each
  row captures the selectors, executor wiring, and outcome metadata for a
  successful run so the planner can rehydrate a known-good flow.
- Indexes: `(subject_id, capability_type)` for lookups during planning, plus a
  timestamp-ordered `(subject_id, last_success_at DESC)` index to promote
  freshest memories.
- Fields:
  - `selectors` – JSON blob with DOM/API selector hints. Treat this as PII‑adjacent:
    redact literal handles, emails, or account numbers before persisting and only
    store hashed or templated selectors that the executor can safely reuse.
  - `outcome_metadata` – structured JSON storing postconditions, costs, receipts,
    or other artifacts that prove the run succeeded.
  - `success_count`, `last_success_at`, `result_summary` – track reliability and
    provide operator context when reviewing audit trails.
- RLS is enabled (policy TODO) so access stays scoped per subject once authz
  lands. Planner/Executor integrations must respect the redaction rule above when
  writing through to this table.

---

## 9) Policy & Guardrails
- **External Policy Gate** (not prompt‑only) enforces:
  1) No asset movement or commitments without explicit consent or within user‑set limits.
  2) No PII to new parties without consent.
  3) Respect legal/channel ToS (e.g., WhatsApp 24‑hour windows, GDPR export/delete).
  4) Explainability: every action must have a human‑readable why/what/source.
- **Everything else is learned** (PAM) or asked once, then remembered.

---

## 10) Payments & Commitments
- **User-provisioned virtual card:** Users generate a virtual card with their bank/issuer and securely share the card details; the PA stores it in Vault and uses it on their behalf within explicit spend limits. Tyrum never issues cards directly.
- **SCA/3DS** handled in-chat; OTP approvals flow through the user’s channel.
- **Budget rules** in PAM (e.g., “auto food < €40 in home city”). Unknown → `Confirm(...)`.
- Prefer vendor APIs; fallback to Web/App checkout with strong postconditions (order #, email receipt).

---

## 11) Watchers & Proactivity (without types)
- **Event sources:** email, messages, calls, calendar, files, webhooks (delivery/order), custom signals.
- **Predicate:** natural-language or DSL compiled to a check (e.g., overlaps ≥ 15 min, ETA slip ≥ 20 min, unanswered VIP email ≥ 24 h).
- **Reaction:** a small plan built from the same primitives (notify, rebook, reschedule).
- The PA proposes/updates rules; user can tweak or disable any watcher.
- Registrations persist to the `watchers` Postgres table; planner services join on `watchers.plan_reference` to hydrate execution plans.
- AuthN/AuthZ is pending for the registration surface; keep route internal until policy gate issues scoped credentials.

---

## 12) Persona & Voice
- **PVP is editable anytime.** Sliders for tone, verbosity, initiative; per‑context adapters (work vs family).
- **Voice:** selectable TTS/clone (with explicit consent), pace/pitch/warmth; per‑contact pronunciation dictionary.
- **90‑second calibration** at onboarding (Appendix E).
- **Safety:** voice cloning only with consent; easy rollback to prior versions.

---

## 13) Auditability & Observability
- **Event‑sourced audit log:** `Message → Plan → Policy Checks → Actions → Observations → Outcome → Cost`.
- **Why‑trace:** short rationales attached to steps (facts/sources only).
- **Metrics & traces:** OpenTelemetry; SLOs for latency (< 2.0 s for text replies when possible), success rate, consent prompts avoided, proactive save events.
- **Repro:** keep selectors/requests to replay flows in a sandbox.

---

## 14) Security & Privacy
- **Secrets:** Vault; per‑user encryption; least‑privilege scopes; signed webhooks.
- **Data subject rights:** export/delete self‑serve; memory redaction and “forget this” commands.
- **KYC/AML:** for wallet issuance; transaction monitoring within limits.
- **Isolation:** Android emulator/VM network egress policies; browser fingerprint rotation where allowed.

---

## 15) MVP Cut (Telegram‑first)
**Scope**
1) Telegram bot + minimal web portal (account linking, export/delete).
2) Discovery pipeline (MCP → Structured → HTTP → Web/Android).
3) Generic executors (Web, Android, CLI, HTTP) with postconditions.
4) Memory (Facts/Episodic/Vector/PAM/PVP + Capability Memory).
5) Wallet integration (virtual card) with spend caps and in-chat 3DS.
6) Watchers: calendar conflicts, VIP email follow‑ups, delivery ETA slips.
7) Policy gate enforcing constitution + per‑user PAM.
8) Full audit log + timeline console.

**Non-negotiables**
- Idempotent actions with replay protection.
- Human-readable confirmations and reasons.
- Cost controls (routing to small models for classification/risk).

### 15.1 CLI executor sandbox (initial cut)
- Runs commands inside an isolated `/sandbox` volume with directory traversal blocked at the boundary. The container launches under a non-root user and refuses to operate if that contract is broken.
- Outbound network access is disabled. Any future allowlist must be reviewed with policy to document domains, rate limits, and audit implications before enabling.
- Planner must surface postconditions that rely solely on stdout/stderr artifacts so we can store diffs without leaking filesystem state outside the sandbox.

---

## 16) Risks & Mitigations
- **UI drift/anti‑bot:** prefer APIs; semantic selectors; retry/relearn; accept some dead‑ends.
- **Latency/cost:** cache schemas/flows; retrieve top‑k tools only; distill routine classifiers to small local models.
- **Legal/ToS:** channel policy packs; user opt‑in for automation; provide API linking when automation is risky.
- **Cold‑start autonomy:** short calibration; default to ask‑first with sensible caps; learn rapidly from approvals.

---

## 17) Success Metrics (examples)
- Time‑to‑first‑value < 5 minutes.
- Confirmation rate decreases over time (learned autonomy).
- Proactive saves per user per month (conflict avoided, rebooking, bill avoided).
- Flow reliability (postcondition pass rate) > 97%.
- Net cost per successful task within target (€).

---

## 18) Data Entities (sketch)
`User, Identity(Channel, Handle), Credential(Provider, Scopes), Consent(Scope, Confidence), Thread, Message, Plan, Step, ToolCall, Observation, Artifact, Memory(Fact|Episodic|Vector|Capability|PAM|PVP), Trigger(EventSource, Predicate, Reaction), Transaction, AuditEvent`.


---

## 19) Branding & Naming — Tyrum

**Primary tagline:** **The end of to-do.**
**Lockline (pair with tagline):** *No lists. Just outcomes—captured, handled, and proven.*

### 19.1 Brand proposition
- **Platform brand:** Tyrum (site, docs, billing).
- **Assistant identity:** user-chosen name (stored in PVP). Present as **“<AssistantName>, by Tyrum.”**
- **Why this architecture:** maximizes personal attachment while keeping a stable platform brand and domain.

### 19.2 Messaging hierarchy (website/ads)
- **H1 (Hero):** *The end of to-do.*
- **Lockline:** *No lists. Just outcomes—captured, handled, and proven.*
- **Proof bullets (support the claim):**
  - Always-on capture from email, messages, calendar, files.
  - Learned autonomy with a PA-managed wallet and safe limits.
  - Generic executors (Web, Android, CLI/HTTP) → works anywhere; structured APIs when discovered.
  - Mandatory postconditions on actions → proof of done.
  - Commitments ledger (not tasks) → two states: handled or needs a decision.
  - Daily brief + tiny decision queue.

**Secondary lines (rotate as subheads):**
- *Intent in. Outcome out.*
- *Outcomes, not apps.*
- *From chat to action.*

**Dutch variants:**
- *Einde aan je takenlijst.*
- *Geen apps. Alleen resultaat.*
- *Zeg het. Klaar.*

### 19.3 Voice & tone (brand)
- **Personality:** calm, confident, minimal; never cutesy.
- **Writing:** short sentences, plain language, outcome-first.
- **Honesty line:** avoid hype; state what’s proven and show evidence (receipts, confirmations, diffs).
- **Style toggles by context:** more formal for work surfaces; warmer for consumer channels.

### 19.4 Naming policy (assistants)
- Users can name their PA; rename anytime (PVP).
- **Channels:**
  - Telegram/WhatsApp: global bot handle is fixed; introduce yourself in-chat as the chosen name.
  - Phone/SIP: set CNAM/display name to the chosen name; provide a vCard.
  - Email: optional alias `name@tyrum.com` per user.

### 19.5 Domain & handles
- **Primary:** tyrum.com.
- **Helpful adjacents:** tyrum.ai, tyrum.app (optional).
- **Patterns:** `hey<name>.tyrum.com`, `ask<name>.tyrum.com`; consider `hey<name>.com` if available later.
- Keep social/bot handles clean: `@tyrum` (brand), `@Hey<AssistantName>` (assistants).

### 19.6 Visual identity starters
- **Logo direction:** geometric **T** monogram + wordmark; avoid alcohol connotations.
- **Palette:** cool blue + graphite base; a single bright accent for confirmations (“Done”).
- **Type:** modern sans (e.g., Inter/Plus Jakarta) for product; serif or high-contrast sans for headlines if desired.
- **Motion:** subtle; emphasize “quietly on it”.

### 19.7 Tagline usage & disclaimers
- Always pair the tagline with a supporting lockline or proof bullets.
- Microcopy for honesty: *“Autonomy within your limits. Asks when uncertain. Every action is explainable.”*

### 19.8 Sample hero section copy
**H1:** The end of to-do.
**Deck:** No lists. Just outcomes—captured, handled, and proven.
**CTA:** *Try Tyrum*  •  *See how it works*
**Trust row:** icons for “Wallet limits”, “Explainable actions”, “Privacy by default”.

### 19.9 Pronunciation & guardrails
- **Pronunciation:** *Tyrum* = **TIE-rum** (note once on early pages).
- Avoid alcohol imagery; keep tech-forward cues.
- Respect legal/channel policies in all brand copy.

---

## 20) Milestones & Roadmap

Milestones are cumulative; later milestones build on earlier ones.

### M0 — Foundations & Guardrails
- **Local container dev environment**
  - `docker compose up` boots Rust API, Next.js portal, Postgres, Redis, and mock LLM locally inside containers within 5 minutes.
- **GitHub repo policies & docs**
  - Branch protections, CODEOWNERS, required reviews, and status checks enforced in GitHub.
  - CONTRIBUTING guide documents dev container workflow, env variables, and expected local smoke tests.
- **Work tracking scaffolding**
  - GitHub Issues templates (bug, feature, chore), default labels, and a project board seeded with M0 backlog items.
- **Rust + web CI workflows**
  - `ci-rust` (fmt, clippy, test) and `ci-web` (lint, test, build) Actions run on PRs and block merges on failure.
- **IaC validation workflow**
  - `ci-iac` runs `terraform fmt -check`, `terraform validate`, `tflint`, `docker compose config`, and `kubeconform` on manifests.
- **Container build smoke workflow**
  - `ci-containers` builds core Docker images with BuildKit and executes `docker run --rm` health checks on main merges.
- **Security baseline workflow**
  - Scheduled `security-baseline` job executes `cargo audit`, `npm audit --audit-level high`, `tfsec`, and `trivy config` against the repo, alerting on failures.
- **Policy check service skeleton**
  - Rust 2024 service exposes `POST /policy/check` with static spend/PII/legal rules returning structured decisions and unit tests for approve/deny/escalate.
- **Consent UX stub**
  - Minimal chat prompt + approval button in Next.js wired to mocked policy responses with snapshot test coverage.
- **Event log foundation**
  - Planner writes append-only action traces with replayable IDs and dedupe guard to Postgres. See `docs/planner_event_log.md` for the schema and API surface.
- **Telemetry pipeline**
  - OpenTelemetry collector container exports traces/metrics/logs to local Prometheus, Grafana, Tempo/Loki dashboards.
  - Developer endpoints and credentials documented in `docs/telemetry_pipeline.md`.
- **Audit replay demo**
  - `make audit-demo` executes a sample plan and verifies replayability via scripted assertion and dashboard screenshot artifact.
- **Memory schema & pgvector base**
  - Migrations create `facts`, `episodic_events`, `vector_embeddings` tables with row-level security placeholders and enable `pgvector`.
- **Memory access tooling**
  - Rust DAL with CRUD coverage and CLI tool to insert/retrieve sample entries backed by unit tests.
- **Planner core crate**
  - Defines action primitive schema, state machine, and documentation for success/failure events.
- **Planner integration harness**
  - Integration test runs mock “book call” plan via generic executors and stores audit + memory artifacts.
- **Planner error propagation**
  - Error handling paths propagate policy denials and executor failures with structured logs and regression tests.
- **Landing page skeleton**
  - Next.js `/` route renders hero/value props with CTA button following design stub.
- **Waitlist capture & analytics**
  - CTA persists email to Postgres waitlist table and emits Plausible/Segment stub events with campaign params.
- **Performance & accessibility baseline**
  - Page scores ≥90 for performance/accessibility/best practices in Lighthouse desktop/mobile runs.
- **Portal auth guard**
  - Next.js middleware validates session cookie; unauthenticated users redirected to onboarding CTA.
- **Portal linking surface**
  - Account linking page shows placeholder integration cards and writes preference toggles to Postgres.
- **Portal export/delete stubs**
  - Export/delete buttons enqueue mocked audit tasks, display toast status, and return deterministic API responses.
  - Next.js portal route `/portal/settings` surfaces export and deletion controls with `/api/account/export` and `/api/account/delete` stubs returning deterministic audit references.
- **Terraform baseline**
  - `terraform plan/apply` stands up staging VPC, Kubernetes cluster, and secrets store without manual steps.
- **Helm chart deployment**
  - Helm releases deploy core services with health checks, config maps, and HPA defaults; `helm test` passes.
- **Infra runbook**
  - Runbook covers `terraform apply`, `helm upgrade`, rollback, and secret rotation procedures with links to dashboards.

### M1 — Telegram MVP (text-first)
- **Telegram ingestion**: Document bot setup & secrets (#58); expose webhook endpoint (#59); normalize updates into shared schemas (#60); persist threads/messages with migrations (#61); add end-to-end webhook test (#62).
- **Planner service**: Define plan request/response contract (#63); stand up planner HTTP surface (#64); integrate policy client (#65); append planner events to audit log (#66); cover policy denial regression (#67).
- **Discovery pipeline**: Create pipeline module (#68); instrument telemetry (#69); hook into planner fallback chain (#70).
- **Executors**: Scaffold Playwright executor (#71); implement navigate/form action (#72); add retries & telemetry (#73); scaffold HTTP executor (#74); deliver CLI sandbox executor (#75); ship Android emulator boot service (#76); implement Android primitive handler (#77).
- **Capability memory**: Extend schema for capability entries (#78); write through planner successes (#79).
- **Wallet integration**:
  - Ship virtual card stub service (#80); call wallet from planner and surface outcomes (#81).
  - `tyrum-wallet` listens on `:8084` and deterministically returns approve/escalate/deny responses using spend thresholds.
  - Stub handles synthetic virtual card payloads only; once live rails land we add encryption-at-rest and vault-backed key management for card data.
- **Watchers**: Configure JetStream client (#82); expose watcher registration API (#83); implement watcher processor worker (#84).
- **Policy guardrails**: Enrich policy with per-user fields (#85); ensure planner error propagation coverage (#86).
- **Audit console**: Add plan timeline API (#87); build portal timeline view (#88).
- **LLM runtime**: Package vLLM container (#89); ship model gateway service + routing config (#90); document model-to-endpoint mapping and guardrails in `docs/infra/model_gateway.md`.
- **Onboarding funnel**: Wire landing to onboarding start (#91); build consent checklist UI (#92); implement verification/session stub (#93).
  - Landing waitlist CTA posts to `/portal/onboarding/entry`, which stubs a portal session cookie and forwards to `/portal/onboarding/start` with flash state so the onboarding checklist can acknowledge waitlist progress.
- **Runbooks**: Update staging runbook for Telegram ingress (#94).

#### Ingress — Telegram Webhook
- `POST /telegram/webhook` lives on the `tyrum-api` service and simply returns `200 OK` when the request is authentic.
- Requests are accepted only when both headers are present and valid:
  - `X-Telegram-Bot-Api-Secret-Token`: exact match with the BotFather `secret_token` configured during `/setwebhook`.
  - `X-Telegram-Bot-Api-Signature`: `sha256=` prefix followed by the lowercase hex HMAC-SHA256 digest of the raw request body using the same secret token.
- Invalid or missing headers are rejected with `401 Unauthorized`; nothing is persisted until signature validation succeeds.
- Normalized payloads are persisted in `ingress_threads` and `ingress_messages`, capturing `pii_fields` so downstream services can redact or encrypt sensitive columns. Field-level encryption is tracked as a follow-up once the policy gate accepts per-column keys.
- Local smoke example (run with the API + Postgres stack online and substitute any payload values you need for manual QA):

```bash
payload='{"update_id":123,"message":{"message_id":1}}'
secret_token='***redacted***'
signature=$(printf '%s' "$payload" \
  | openssl dgst -binary -sha256 -hmac "$secret_token" \
  | xxd -p -c 256)

curl -X POST http://localhost:8080/telegram/webhook \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: $secret_token" \
  -H "X-Telegram-Bot-Api-Signature: sha256=$signature" \
  -d "$payload"
```

 ```bash
 psql "$DATABASE_URL" <<'SQL'
 SELECT thread_id, kind, pii_fields FROM ingress_threads WHERE source = 'telegram';
 SELECT thread_id, message_id, pii_fields FROM ingress_messages WHERE source = 'telegram';
 SQL
 ```

### M2 — Reliability & Capability Memory
- Capability Memory read/write: selectors, flows, success/failure patterns; reuse on subsequent runs (#8).
- UI drift handling: semantic selectors, retries/backoff; teach-back and acceptance of dead-ends (#16).
- Tool Directory top-k retrieval and caching (#5, #6).
- Cost controls: cache schemas/flows in Redis 7; small local models for classification/risk (Appendix G, #16).
- Postcondition libraries for common actions; replay sandbox (#13).
- Kubernetes rollout strategies and autoscaling for Rust services and Next.js portal; Redis 7 clustering for session/state resilience (#5, #16).

### M3 — Persona & Voice
- PVP editor (tone, verbosity, initiative, consent style) with on‑the‑fly tweaks (#12, Appendix B).
- 90‑second calibration in onboarding (Telegram) (#12, Appendix E).
- Voice notes + TTS; per‑contact pronunciation dictionary (#12).
- Explainability in voice: concise rationales tied to audit events (#13).

### M4 — Structured Integrations & MCP
- MCP discovery and scope granting per policy (Appendix C).
- OpenAPI/GraphQL discovery via headers/manifests/.well‑known; schema cache (#6).
- Prefer structured APIs; fall back to generic executors when needed (#6).
- Per‑vendor capability memories including known costs and anti‑bot quirks (#8, #16).

### M5 — Portal, Privacy & Admin
- Web portal expansion: account linking, export/delete, memory redaction, “forget this” (#14, #15.1).
- Audit timeline console with replay and evidence artifacts (#13).
- Per‑user spend/compute quotas; graceful degradation (Appendix G).
- KYC/AML for wallet issuance; transaction monitoring within limits (#14, #10).
- Secrets management, least‑privilege scopes, signed webhooks (#14).

### M6 — Multichannel & GA Readiness
- WhatsApp Business/iMessage (policy permitting), email, and voice calls (SIP/WebRTC) (#4).
- Daily brief and tiny decision queue surfaced in chat and portal (#19.2).
- Branding, domains/handles, and basic marketing site content (#19).
- SLOs met (latency, reliability, cost); multi‑tenant hardening; Android/VM isolation and egress policies (#13, #14, #17).
- GA checklist: legal/ToS packs, support, billing, analytics and growth instrumentation.

---

## Appendix A — Action Primitive Schema (minimal)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ActionPrimitive",
  "type": "object",
  "properties": {
    "type": {"type": "string", "enum": [
      "Research","Decide","Web","Android","CLI","HTTP","Message","Pay","Store","Watch","Confirm"
    ]},
    "args": {"type": "object"},
    "postcondition": {"type": ["object","null"]},
    "idempotency_key": {"type": "string"}
  },
  "required": ["type","args"],
  "additionalProperties": false
}
```

**Postcondition examples:** DOM/text assertion, HTTP status/body predicate, email receipt detected, calendar diff exists.

---

## Appendix B — Persona & Voice Profile (PVP) Schema (example)
```json
{
  "tone": {"type": "string", "description": "calm|energetic|witty|formal|playful"},
  "verbosity": {"type": "string", "description": "terse|balanced|thorough"},
  "initiative": {"type": "string", "description": "low|medium|high"},
  "consent_style": {"type": "string", "description": "ask_first|ask_once_per_vendor|act_within_limits"},
  "emoji_gifs": {"type": "string", "description": "never|sometimes|often"},
  "language": {"type": "string"},
  "context_rules": [{"context": "work|family|friends", "overrides": {}}],
  "voice": {
    "voice_id": "string",
    "pace": "number",
    "pitch": "number",
    "warmth": "number",
    "pronunciation_dict": [{"token": "string", "pronounce": "string"}]
  }
}
```

---

## Appendix C — MCP Discovery (minimal spec)
1) Try linked endpoints from user accounts or `.well-known/mcp`.
2) If found, fetch capability list, auth methods, scopes, rate limits, and side‑effects.
3) Present to policy gate for scope grant; cache on success.
4) If not found or denied, silently continue down the discovery chain.

---

## Appendix D — Watchers (examples)
- **Calendar overlap:** `predicate: overlaps(event_a, event_b) >= 15m` → `reaction: propose new slots; if under limit, reschedule`.
- **VIP email idle:** `predicate: from in VIP && no_reply >= 24h` → `reaction: draft reply + notify`.
- **Delivery slip:** `predicate: eta_slip >= 20m` → `reaction: contact vendor + notify`.

---

## Appendix E — 90‑Second Calibration Script (Telegram)
1) *Tone check:* “Prefer more upbeat or more neutral?”
2) *Verbosity:* “Short and crisp, or thorough by default?”
3) *Initiative:* “Ask before acting, ask once per vendor, or act under limits?”
4) *Quiet hours:* “When should I avoid non‑urgent messages?”
5) *Spending:* “Safe to auto‑approve everyday buys under €X in your area?”
6) *Voice sample:* send two short audio styles → “Which do you prefer?”
7) Store PVP + PAM; confirm: “Change anytime: *‘be more concise’*, *‘use fewer emojis’*, *‘stop auto approvals’*.”

---

## Appendix F — Sample Audit Event
```json
{
  "trace_id": "a1b2c3",
  "user_id": "u_123",
  "message_id": "m_456",
  "plan": [{"type":"Web","args":{"navigate":"https://placex.com"},"postcondition":{"contains_text":"Menu"}}],
  "policy_checks": [{"rule":"spend_limit","result":"ok","limit":40,"amount":27.8}],
  "actions": [{"executor":"Web","result":"ok","evidence":{"screenshot":"s3://..."}}],
  "outcome": {"status":"success","summary":"Ordered two bowls, €27.80"},
  "cost": {"llm_tokens": 1432, "exec_time_ms": 4120},
  "timestamp": "2025-10-03T18:12:44Z"
}
```

---

## Appendix G — Cost Controls
- Route intent/risk classification to small local models.
- Cache API schemas and successful flows.
- Retrieve only top‑k tools per task.
- Batch background enrichment and summarization.
- Enforce per‑user spend/compute quotas with graceful degradation.

---

**End of Document**

**Brand:** Tyrum
**Tagline:** The end of to-do
