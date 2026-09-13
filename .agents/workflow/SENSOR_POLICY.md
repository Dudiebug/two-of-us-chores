# Sensors and acceptance evidence

A sensor is a real executable check, available tool call, or defined human
observation. Registering its name does not implement it. Use existing runners.
This kit provides no universal product-test executor and never auto-executes
commands from an untrusted profile.

## Binding contract

Record ID, kind, behavior measured, command as an argument array (or exact tool
name/arguments), working directory, source/config binding, environment,
prerequisites, owner, effect category, pass condition, limitations and evidence
output. Keep workflow checks separate from product checks. A human sensor needs
a reproducible checklist and matching candidate/build instead of invented argv.

Declared availability and a parser's structural success do not prove execution.
Each measured invocation needs actual candidate/config/platform identity, time,
exit status, meaningful work/case counts when applicable, outcome and raw evidence.
A report path in a profile is only a location; it is not a completed result.

## Selection

Use the union of checks relevant to the changed contracts and risk. Compile/type
checks detect structural mistakes; behavioral checks need real assertions.
Protocol, auth, persistence, concurrency, ABI and visible/runtime behavior require
appropriate observations at the boundary they claim to validate. Fixtures can
prove adapter decisions but not the external system they replace.

Do not default to every suite, whole-repository mutation, arbitrary coverage
thresholds, broad architecture scans or graph rebuilds. At the milestone run all
applicable required checks once. Do not downgrade an earlier failed required check
to OPTIONAL/PENDING or remove its criterion after seeing the result.

## Checker integrity

Missing inputs/tool, malformed output, crash, timeout, empty test selection,
all-skipped selection and unreadable evidence cannot PASS. Use FAIL for observed
violations and UNVERIFIED for missing measurement. A failed runner may include
both a product failure and incomplete coverage; preserve both facts.

For custom enforcement, prove a known-bad fixture reaches a failing exit/status
before trusting green. Inspect that the checker measures behavior rather than a
source spelling alone. Record what the negative control does and does not cover.
Do not mask exit codes with `|| true`, swallowed exceptions, unconditional success
messages or thresholds that only print warnings. Source-text checks are structural
only and cannot be mislabeled runtime/behavioral acceptance.

## Reuse and invalidation

Keep results scoped to candidate, artifact and platform. A different native DLL,
protocol/schema, dependency/toolchain or relevant runtime setting may invalidate
prior evidence. Let actual repository contracts decide what needs rerun. Do not
require whole-repo hashes for every edit when commit/diff plus scoped artifact
identity suffices. Do not revalidate unrelated findings solely because a file's
unrelated lines changed.

Keep original failed runs/analyzer versions and mark corrected analysis explicitly.
A measurement fix is not a retest of the product. A worker/human report is labeled
as such; direct execution is a separate provenance claim. No overwritten raw
results, retroactive threshold tuning or hidden baseline refresh.

## Human/runtime boundaries

Bind exactly who owns each check. A requirement assigned to the human is PENDING
until supplied, not permission for the agent to launch a game or live device.
Conversely, an unavailable compiler is UNVERIFIED, not a human gameplay deferral.
Deliver a numbered checklist with starting state, exact build, action, expected
result and required evidence. Runtime feedback can reopen a completed implementation
scope; it cannot be silently ignored because offline checks passed.

## Evidence record

One concise existing task/report record is enough. Map criteria -> checks/results;
link raw logs. Keep explicit limits and still-owed milestone obligations. No giant
report hierarchy for routine fixes. The optional JSON profile validator checks
configuration only; it is neither an evidence authenticity verifier nor a
sandbox/permission enforcement mechanism.
