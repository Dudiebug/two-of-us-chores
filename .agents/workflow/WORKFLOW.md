# Single-agent engineering workflow

**Core 3.0.0 | Default: one primary agent, optional delegated work**

## Contract

The primary agent owns the whole task. Planning, implementation, test authoring,
verification, repair and review are roles it can perform serially, not mandatory
separate agents. `PROFILE.json` supplies repository-specific bindings and inherited
rules. The profile is descriptive configuration, not a sandbox or permission grant.

Applicable host instructions and permissions govern all actions. Within those
limits, current authorized requirements define intended behavior; repository
instructions and approved plans constrain the work. Source and observations show
what exists. A contradiction is investigated, not resolved by pretending an
inconvenient requirement or measurement does not exist. Graph output is advisory.

Read `SKILLS.md` once for composition. Read `SENSOR_POLICY.md` for novel or risky
checks, `DEBUG_REVIEW.md` for difficult failures, and `DELEGATION.md` only when
assigning work. Keep routine edits light.

## 1. Orient

Identify the actual checkout/candidate and unrelated changes. Read relevant
instructions, accepted task/plan, source, declarations, callers, tests and useful
past evidence. Establish responsibility boundaries before selecting an edit.
Use scoped Graphify queries for topology when helpful, then verify source.
Do not rebuild or rescan the whole repository on every turn.

For a bug, establish the first failing observable boundary and positive upstream
behavior. For a feature, identify the real consumer and acceptance oracle. For
an investigation, define the question and stop before unauthorized implementation.

## 2. Contract and risk

Choose a proportional route before coding:

| Route | Typical work | Expected evidence |
| --- | --- | --- |
| Small | Clear local fix, docs/config with bounded effect | Relevant source/diff review plus existing focused check or compile where sufficient |
| Standard | Behavior change or feature spanning a few real boundaries | Observable contract, relevant negative cases, focused production-code tests and integration as needed |
| High assurance | Auth, data loss, persistence, concurrency, network authority, costly API breakage | Failure model; Old Coder high-assurance procedure adapted to repo policy; stronger relevant behavioral and adversarial evidence |

A small diff is not automatically low risk. Compilers do not prove authorization,
persistence or network behavior. Use high assurance when requested, and state
which requirements or upstream skill procedures are being adapted. Do not claim
an unmodified full gauntlet when only proportional checks were run.

For a small fix, the existing issue/record and a few lines of criteria suffice.
Substantial work needs a durable contract: inputs/outcomes, prohibited behavior,
owned files, risks, selected checks, allowed mocks, completion scope and rollback.
Use `templates/TASK.md` only when an existing task format is absent or inadequate.
Separate explicit human approval from autonomous interpretation.

## 3. Plan evidence before choosing code

Map each criterion to the actual sensor that can observe it. Define assertions
from expected behavior, not from the code's current result. Reuse fixture/reset
rules, test commands and existing runners. Keep relevant tests, avoid redundant
implementation-mirroring checks. Add a regression when it catches plausible
recurrence or resolves uncertainty, not as mandatory paperwork for every edit.

Read/check new runner commands before executing them; test scripts can launch
services or write data. A CLI help result or configured MCP entry is not proof
that a behavioral test can execute. Record prerequisites and ownership.

## 4. Implement

Apply Ponytail after understanding the responsible code path. Reuse what already
owns the behavior. Prefer standard/native facilities and installed dependencies.
Keep the smallest readable implementation satisfying the complete contract.
Do not create another pathfinder, transport, scanner, storage engine, workflow
runner or abstraction to hide a failure in an existing responsible component.

The primary agent can change production and test code as needed. Keep requirement
changes explicit; never edit both expected behavior and implementation solely to
remove a failure. For high assurance use deliberate test-first steps where
required. Preserve protected/generated boundaries and inspect all real callers.

## 5. Measure and repair

Run the smallest relevant checks on the current candidate. Record the invocation,
environment, actual outcome, executed case count where applicable, artifact links
and what the check cannot show. Reference still-applicable prior evidence rather
than relabeling it as a fresh execution.

Classify failure: implementation, test/spec contradiction, sensor/harness,
environment or missing authority/access. Fix the smallest proven cause. Do not
suppress warnings, loosen tolerances, mock away the boundary, repeatedly rerun a
flake until green, or edit a baseline to erase a new regression.

After two materially unsuccessful repairs of the same hypothesis, record what
was disproven and replan. Continue when the next justified action is within scope;
otherwise leave a concrete blocker and preserved patch/evidence. Failed checks
remain failures until a new relevant result or authorized exception supersedes
them. Missing required tools are UNVERIFIED, not deferred human tests.

Repeat a passed check only after a relevant source/build/config change or new
contradictory evidence. Broader runs need a concrete risk or milestone gate.

## 6. Review the candidate

Read the actual diff, including new/untracked files intended for delivery. Check
contract coverage, callers, architecture, new dependencies/capabilities, security
and lifecycle risks, test assertions, evidence provenance and unintended changes.
Use `DEBUG_REVIEW.md` where relevant. Do not substitute an agent's confident
summary for source and results. A same-agent review is recorded as `self_review`.

Delegated work is inspected and integrated by the primary agent. Integration can
invalidate passing isolated checks; rerun affected checks on the combined tree.
One fresh independent reviewer, when required, must be separate from authoring the
candidate being judged. It supplies evidence; it does not auto-approve itself.

## 7. Finish at the right scope

Use existing task states. Defaults are PLANNED -> IN_PROGRESS -> COMPLETE;
BLOCKED records an actual obstacle. Task completion requires required task
criteria and review, not just a zero exit code. Continue eligible next tasks
within the user's authorized scope without requiring user-carried handoffs.

Milestone acceptance is separate. Run the complete applicable milestone checks
once, deduplicate shared checks and retain evidence that remains applicable.
Preserve required independent review and human runtime checks. A single-agent
setup does not waive an inherited independent gate; it leaves it PENDING until
an eligible separate session/person supplies it. Repeating a reviewer prompt in
the same context does not create independence.

Deliver code/builds after their implementation scope is complete when the repo
permits pending runtime testing. Do not claim an end-to-end or release result that
requires the pending check. Exceptions require the existing authority, retain the
actual failing/missing outcome, and name the exception's scope.

## Outcome vocabulary

- **PASS:** relevant check executed and met its defined pass condition.
- **FAIL:** executed check found a violation; retain the evidence.
- **UNVERIFIED:** required evidence is unavailable, unusable or not executed.
- **PENDING:** explicitly assigned future/human/milestone obligation, never a
  disguise for a failed or unavailable required task check.
- **NOT_APPLICABLE:** a documented reason that the check does not cover this scope.

`SKIPPED` is an execution fact needing one of these dispositions, not PASS.
Historical, worker-reported, human-reported and independently rerun evidence are
labeled distinctly. A passed mock contract is not live integration acceptance.

## Context and delivery

Use one concise canonical evidence/task record; link logs rather than cloning
reports. Capture candidate identity, changed behavior, commands/outcomes, relevant
reused evidence, unknowns and next action. For long work, checkpoint after material
progress and before context loss. On resume verify candidate and invalidations.
Keep local paths/secrets out of shared artifacts unless strictly necessary.

No new report, graph build, helper or full suite is required for each small repair.
No daemon, model setting change, automatic push or live service/game launch is
part of this workflow. Preserve actual project permissions and owned-process
cleanup. The workflow guides an agent; it cannot enforce tool isolation by prose.
