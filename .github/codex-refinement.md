# Codex Refinement Workflow

This workflow keeps product refinement anchored in GitHub while letting Codex keep
issue-specific context in durable threads.

The core principle is:

> Daily refinement is not a way to create more issues. It is a way to convert
> product observations into better decisions, and only then into implementation
> work.

## Source Of Truth

GitHub is the planning source of truth:

- Issues hold durable product work records.
- A Product Refinement Hub issue tracks cadence, capacity, and cross-team
  learning.
- Daily sweep issues hold each review's audit trail.
- Parent issues hold refinement initiatives from daily vantage reviews.
- Sub-issues hold MR-sized implementation work.
- Pull requests close the MR-sized issue they implement.
- Projects provide cross-cutting views and custom fields.
- Milestones group release or polish cycles.

Codex threads are execution context, not the source of truth. A thread can explain,
refine, and implement work, but the issue must contain the current scope,
acceptance criteria, status links, and relevant decisions.

## Issue Hierarchy

Use one long-lived Product Refinement Hub issue per product. The hub owns:

- the current refinement cadence
- weekly intake capacity
- vantage rotation
- links to daily sweep issues
- links to active parent initiatives
- cross-team learning notes
- stale-work review status

Use one daily sweep issue per review pass. A daily sweep owns:

- the date and vantage point reviewed
- sources inspected
- raw candidate findings
- duplicate decisions
- promotion gate decisions
- rejected or deferred observations
- links to created or updated parent and child issues

Use one parent issue for each durable product refinement initiative. The parent
issue owns:

- the originating vantage point
- the prioritized candidate list
- duplicate and overlap decisions
- links to child issues
- the parent Codex coordinator thread
- synthesis of child outcomes

Use one sub-issue for each MR-sized deliverable. A sub-issue owns:

- one merge-request-sized objective
- acceptance criteria
- non-goals
- validation expectations
- the child Codex implementation thread
- the closing pull request

The combined structure is:

```text
Product Refinement Hub
  -> Daily Sweep Issue
      -> Candidate findings
      -> Duplicate decisions
      -> Promotion/rejection decisions

  -> Parent Refinement Issue
      -> Problem framing
      -> Priority
      -> Evidence
      -> Decomposition
      -> Codex coordinator thread

        -> Child Issue
            -> One MR-sized implementation slice
            -> Acceptance criteria
            -> Validation
            -> Rollback
            -> Codex implementation thread
            -> Pull request
```

## Thread Reuse

Each GitHub issue gets one reusable Codex thread.

Before creating a thread, automation must read the issue body and comments for an
existing `codex-thread-map` block. If a thread id is present, reuse that thread.
Create a replacement thread only when the recorded thread is inaccessible, and
record that replacement in the issue.

Parent issue threads are coordinator threads. They refine, dedupe, create or
select child issues, spawn child threads, and synthesize child status back into
the parent issue.

Child issue threads are implementation or focused refinement threads. They should
be spawned from the parent thread after the child issue exists, so the child
inherits the relevant context while still getting a crisp prompt scoped to the
child issue.

## Metadata Block

Every refinement issue template includes a hidden metadata block:

```md
<!-- codex-thread-map
version: 1
issue: pending
role: parent
parent_issue:
root_issue: pending
codex_thread_id:
codex_thread_url:
spawned_from_thread_id:
last_sync:
-->
```

Automation may update the values, but it should preserve the block name and
field keys. The repository helper at `scripts/codex-thread-map.mjs` can extract
or update the block in an issue body file.

## Activation Script

Use `scripts/refinement-github.mjs` for GitHub setup and issue metadata sync.
The script defaults to dry-run mode; pass `--apply` only when making live GitHub
changes.

```bash
node scripts/refinement-github.mjs doctor
node scripts/refinement-github.mjs setup --apply
node scripts/refinement-github.mjs create-sweep --apply
node scripts/refinement-github.mjs sync-thread-map --issue 123 --thread-id thread_abc --thread-url https://example.invalid/thread_abc --apply
```

Authenticated GitHub operations use `/opt/homebrew/bin/gh` by default.

## Daily Review Flow

1. Read the Product Refinement Hub, current open refinement issues, active
   sub-issues, recent pull requests, and recent daily sweep issues.
2. Create or update the daily sweep issue for the review pass.
3. Run one vantage review per scheduled pass, rotating through:
   Architecture, UX/UI, End User, Sales/GTM, Reliability/Ops, Security/Privacy,
   Developer Experience, Documentation, and Performance/Cost.
4. Produce a prioritized list of candidates with size, confidence, evidence,
   target package or surface, and duplicate candidates.
5. For every candidate, apply the promotion gate and decide one action: ignore,
   watch, merge, promote to parent, promote to child, or escalate.
6. Check the weekly capacity budget before creating new durable work.
7. Reuse the issue's Codex thread if it exists. Otherwise create the coordinator
   or implementation thread and record it in the issue.
8. The parent thread creates or selects MR-sized sub-issues and spawns child
   Codex threads from the parent context.
9. Child threads implement one sub-issue at a time in separate worktrees and open
   one pull request each.
10. Parent threads periodically synthesize child outcomes back into the parent
    issue.
11. Close the daily sweep issue after its summary, decisions, and links are
    synced to the hub and relevant issues.

## Promotion Gate

A finding is not durable work until it passes a promotion gate. Classify every
finding before creating or updating long-lived work:

| Bucket              | Meaning                                            | Action                            |
| ------------------- | -------------------------------------------------- | --------------------------------- |
| `Ignore`            | Not valuable enough or not real                    | Capture only in sweep notes       |
| `Watch`             | Interesting but not proven                         | Revisit later with more evidence  |
| `Merge`             | Already covered by existing issue                  | Update existing issue             |
| `Promote to parent` | Real opportunity, not yet sliced                   | Create or update parent issue     |
| `Promote to child`  | Clear MR-sized fix                                 | Create or update child issue      |
| `Escalate`          | Security, reliability, legal, or customer-critical | Fast-track outside normal cadence |

Promotion should require at least one of:

- strong user, customer, operator, or maintainer impact
- clear evidence from product behavior, code inspection, support, sales, docs, or
  operational signals
- obvious low-risk cleanup that removes future friction
- security, reliability, privacy, or compliance urgency

## Capacity Budget

The daily review should respect a product-level intake budget so refinement does
not grow faster than delivery. The hub should record the current budget. The
default starting point is:

- no more than `3` new parent refinement issues per week
- no more than `5` new child issues per week
- no new child issue when the parent already has too many open children, unless
  the work is urgent
- urgent `Escalate` findings may bypass the budget, but the sweep must record why

If the team repeatedly exceeds the budget, the next weekly review should adjust
either the budget, the promotion criteria, or the delivery capacity.

## Suggested Project Fields

Use a GitHub Project to view and triage the refinement system:

- `Vantage`: Architecture, UX/UI, End User, Sales/GTM, Reliability/Ops,
  Security/Privacy, Developer Experience, Documentation, Performance/Cost
- `Issue role`: Hub, Daily sweep, Parent, Child
- `Size`: XS, S, M, L, XL
- `Priority`: P0, P1, P2, P3
- `Confidence`: Low, Medium, High
- `Refinement state`: Candidate, Refining, Ready, In progress, Blocked, Done,
  Duplicate, Won't do
- `Codex thread`: URL or thread id
- `Parent issue`: issue number
- `Duplicate of`: issue number

## Size Scale

- `XS`: documentation, copy, or tiny focused fix
- `S`: one small module or one narrow UI state
- `M`: one coherent MR across a small number of related files
- `L`: must be split into sub-issues before implementation
- `XL`: initiative only; never implement as one MR

Child issues must be `XS`, `S`, or `M`. `L` and `XL` work must remain parent
issues until split.

## Duplicate Control

Daily review must read existing issues before creating new work. A candidate is a
duplicate when it has substantially the same user outcome, root cause, acceptance
criteria, and target surface as existing open or recently closed work.

When uncertain, prefer updating the existing issue with new evidence instead of
creating a near-duplicate. If separate work remains justified, link the issues
with an explicit dependency or sub-issue relationship.

## Definition Of Ready

A child issue is ready for Codex implementation when:

- the problem is clear
- the scope is MR-sized
- non-goals are listed
- acceptance criteria are testable
- validation method is known
- rollback or revert strategy is clear
- duplicate check is complete
- parent issue is linked
- Codex thread is linked or ready to create

## Definition Of Done

A child issue is done when:

- pull request is merged or the issue is explicitly rejected
- acceptance criteria are verified
- tests or docs are updated where needed
- screenshots, logs, or evidence are attached when relevant
- parent issue is updated
- follow-ups are captured
- Codex thread status is synced back to GitHub

## Outcome Review

Completed child issues should record a lightweight outcome review:

| Question                                      | Expected answer style             |
| --------------------------------------------- | --------------------------------- |
| Did this solve the original problem?          | Yes / Partly / No                 |
| Was the estimate accurate?                    | XS/S/M predicted, actual size     |
| Was the pull request size appropriate?        | Good / Too large / Too fragmented |
| Did it create follow-up work?                 | None / Minor / Major              |
| Was the originating vantage point valuable?   | High / Medium / Low               |
| Should this pattern be reused by other teams? | Yes / No                          |

## Weekly Cross-Team Learning

Each product team should bring one reusable learning per week. Compare:

- sweeps completed
- candidates found
- candidates promoted
- duplicates avoided
- child issues created
- pull requests merged
- average child issue size
- findings by vantage point
- findings by product surface
- template or workflow changes worth copying

## Stale-Work Cleanup

Use these default cleanup rules:

- parent issue with no child movement for `30` days gets reviewed
- child issue with no pull request activity for `14` days returns to parent
- daily sweep issues close after summary is synced
- duplicate or superseded issues close with a link to the surviving issue
- parent issues close only when all children are done, rejected, or moved

## GitHub CLI Note

On Ron's local machine, use the Homebrew-installed GitHub CLI at:

```bash
/opt/homebrew/bin/gh
```

GitHub CLI operations may require macOS keychain access. Run authenticated `gh`
commands outside the filesystem sandbox with explicit approval.
