# Debugging and review protocols

Original workflow methods; no additional third-party installation is assumed.

## Root-cause experiment

Write the smallest falsifiable hypothesis that explains the observed fault.
Separate symptoms, observations and hypotheses. Inspect upstream input and
ownership before blaming the next subsystem. Identify what measurement would
confirm/refute the first broken boundary and what valid upstream behavior should
remain visible.

Choose a bounded diagnostic with known starting state and cleanup. Observe before
mutating when practical; don't change several unrelated variables together.
Define acceptance limits before the run. Keep diagnostic writes out of acceptance
that claims natural behavior. Bind observations to candidate/process/resource
identity and timing uncertainty where timing is material.

Run it, record expected versus actual behavior, and retain failure. Remove the
experimental change or keep it explicitly opt-in if it did not establish the
hypothesis. Correct a proven measurement defect visibly, preserving original raw
data. After two failed attempts at the same explanation, change the explanation
or improve the measurement rather than widening tolerances.

Prefer one fix at the actual responsible boundary. No duplicated subsystem,
recurring state overwrite, permission bypass or hardcoded success condition to
hide the fault. Rerun the affected behavioral check and relevant negatives.

## Diff review

Ask only the questions relevant to this change, but inspect real source/evidence:

- Does it meet the complete requested behavior and preserve non-goals/callers?
- Is the code in the component that owns this responsibility, or a workaround copy?
- Do trust/authority checks validate the real owner, identity, world/session/tenant,
  boundary and lifecycle on every sensitive action?
- Can partial writes, cancellation, retries, duplicate/out-of-order input, stale
  handles, timeouts, restart or concurrency lose data or violate the contract?
- Are resources bounded and errors observable without leaking secrets?
- Did new network, subprocess, dependency, file, environment, privilege or
  publishing capabilities appear without justification?
- Do tests exercise production behavior and meaningful expected results, including
  plausible negatives, rather than mocks or duplicated implementation logic?
- Does each reported outcome match a real command, artifact and applicable candidate?
- Is the shortest patch also readable, robust and complete? What unnecessary code
  or duplicated report can be removed without weakening a real guarantee?

Record unresolved findings, not a ceremonial checklist filled with PASS. Treat
pre-existing debt separately from new regressions. Fix within scope; raise a
contract decision when the fix would change approved behavior. Do not pretend
same-context review is an independent opinion.
