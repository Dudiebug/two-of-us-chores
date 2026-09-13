# Optional delegation, same contract

Default mode is `single`. `optional_multi` means the primary agent may use real
supported delegation where valuable; it does not require helpers. Both modes
can finish directly. There is no required model name or hidden fallback provider.

## Before assignment

The host must provide an actual supported delegation action, sufficient permitted
resources, and explicit writable ownership. Read the exact tool schema. Do not
spawn processes/models through an improvised shell bridge to bypass host limits.
Read-only parallel research is usually easier to isolate than implementation.
Delegate only when the saved work exceeds coordination/review cost.

## Assignment

Use one coherent self-contained contract: task/revision, starting candidate,
applicable rules, role (research, implementation, tests, review), dependencies,
owned writable files, adjacent read scope, intended behavior/negative cases,
allowed mocks, checks and output. For test authors, supply expected outcomes
from the approved requirement, not the production algorithm. A helper cannot
rewrite production behavior to satisfy its tests unless explicitly assigned.

Use disjoint files or isolated worktrees. The primary agent reserves shared build
files/configuration and integrates sequentially. All helpers preserve unrelated
changes; none reset/clean the checkout. No recursive delegation, policy edits,
acceptance state changes, publishing or elevated capabilities.

## Return and integration

Return actual diff/new files, resulting identity, tests run with outcomes and
limitations, blockers and unresolved assumptions. If work is incomplete, return
usable partial work rather than reporting success. Escalate ambiguity/failure to
the primary agent, not to another helper or directly into user-review chores.

The primary agent reads the patch and assertions, verifies evidence applicability,
resolves conflict, integrates and reruns checks invalidated by the combined tree.
An isolated worker PASS is not integrated-candidate PASS. Reuse a useful helper
context for related assignments; no mandatory repeated reviewer chain.

## Independence

A fresh verifier must not have implemented the candidate or written the tests
whose independent review is required. Give it the contract, clean/reconstructible
candidate and raw evidence, not the implementer's confidence narrative as truth.
It reports findings and missing measurements; the controller applies acceptance
policy. Repair remains outside that verification context where independence is
required. A later relevant repair needs review of its invalidated evidence.

A self-review is honest and useful but not independent. In single-agent-only
hosts, preserve inherited independent gates as PENDING, or use an eligible fresh
session/person when available. Do not require independent review for every small
fix when the repository does not require it. No helper is necessary to use this
workflow for normal development.
