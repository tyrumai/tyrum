---
name: Product refinement work item
about: MR-sized sub-issue under a refinement initiative
title: "[Work Item] "
labels: "product-refinement, mr-sized"
assignees: ""
---

<!-- codex-thread-map
version: 1
issue: pending
role: child
parent_issue:
root_issue:
codex_thread_id:
codex_thread_url:
spawned_from_thread_id:
last_sync:
-->

## Parent Issue

Closes part of #

## Origin

- Daily sweep issue:
- Vantage:

## Objective

Describe the one MR-sized outcome this issue should deliver.

## Definition Of Ready

- [ ] Problem is clear.
- [ ] Scope is MR-sized.
- [ ] Non-goals are listed.
- [ ] Acceptance criteria are testable.
- [ ] Validation method is known.
- [ ] Rollback or revert strategy is clear.
- [ ] Duplicate check is complete.
- [ ] Parent issue is linked.
- [ ] Codex thread is linked or ready to create.

## Acceptance Criteria

- [ ]

## Non-Goals

-

## Size

- [ ] XS
- [ ] S
- [ ] M

If this is larger than `M`, split it before implementation.

## Rollback Or Revert Strategy

-

## Validation

- [ ] Unit or focused regression tests are added where appropriate.
- [ ] `pnpm test` or a narrower relevant test command is run.
- [ ] `pnpm typecheck` is run when TypeScript behavior changes.
- [ ] `pnpm lint` is run when source files change.
- [ ] `pnpm format:check` or changed-file formatting is run.

## Definition Of Done

- [ ] Pull request is merged or the issue is explicitly rejected.
- [ ] Acceptance criteria are verified.
- [ ] Tests or docs are updated where needed.
- [ ] Screenshots, logs, or evidence are attached when relevant.
- [ ] Parent issue is updated.
- [ ] Follow-ups are captured.
- [ ] Codex thread status is synced back to GitHub.

## Outcome Review

| Question                                      | Answer |
| --------------------------------------------- | ------ |
| Did this solve the original problem?          |        |
| Was the estimate accurate?                    |        |
| Was the pull request size appropriate?        |        |
| Did it create follow-up work?                 |        |
| Was the originating vantage point valuable?   |        |
| Should this pattern be reused by other teams? |        |

## Codex Thread Protocol

- Reuse the child Codex thread recorded in `codex-thread-map`.
- This child thread should be spawned from the parent issue thread.
- Keep implementation scoped to this issue and open one pull request.
