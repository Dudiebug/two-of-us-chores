# Skill composition and resolution

This file is an original integration policy, **not** the upstream skills' text.
Read actual available definitions before claiming to use them. `SKILL_SOURCES.json`
contains reviewed reference commits; installed compatible revisions may differ.

## Resolve once per setup, reuse within the task

Check native skill discovery and existing project/user skill locations accessible
under current permission. Record actual entry point, version/revision and whether
sidecars resolve. Prefer the existing installation. Do not install duplicates in
every host's folder. If absent, read pinned upstream Markdown through available
file/repository tools. See `INSTALL_SKILLS.md` for a safe project-scoped path.

The generic profile tracks definition availability separately from tool/runtime
availability. `REFERENCED` is not `AVAILABLE`; a downloaded skill is not a working
Graphify CLI. With missing optional tools use the documented fallback and disclose
it. Required unavailable evidence blocks only the scope that needs it.

## Old Coder -> tests and evidence

Primary source: `AmazingAng/old-coder`, `skills/old-coder/SKILL.md` and relevant
`references/` files. Read the actual skill for explicitly requested/risk-triggered
high assurance. Routine test work uses Old Coder-informed principles in this local
policy without forcing the full upstream loop. Record the distinction.

Define concrete behaviors and negative constraints first. Map tests to requirements,
use real production code, avoid mocking the unit under test, and check failure
paths. For a new custom mandatory checker, demonstrate rejection of a known-bad
fixture. For risky work, add only the fault-model layers that measure the risk:
concurrency, persistence/rollback, API compatibility, property-based or mutation
checks, fuzzing or performance budgets as appropriate.

Conflict resolution: inherited project cadence and authorized task contract govern
when broad suites, RED/GREEN and coverage/mutation layers are due. They are not
silently imposed on every small change by loading a skill. Conversely, a requested
full gauntlet is not silently weakened to the small-fix route. Report autonomous
specification approval as not obtained. Keep useful regressions and evidence;
no changing or skipping expectations simply to get green.

## Ponytail -> implementation and review

Primary source: `DietrichGebert/ponytail`, `skills/ponytail/SKILL.md`.
Use the existing reasonable mode, normally full, after tracing the affected flow.
Reuse responsibilities and existing facilities before writing another abstraction.
A smaller patch in the wrong component is not a better patch. Keep readability,
required scope and robust failure behavior ahead of minimum line count.

Conflict resolution: safety, correctness, explicit behavior, required test layers
and truthful delivery override shortest-output and minimum-test slogans. No
unrequested global refactor or mass deletion. An optimization/shortcut with a
real ceiling gets one specific debt note and trigger, not speculative scaffolding.
Do not install lifecycle hooks just to make the skill appear always active.

## Graphify -> structural context

Primary source: `Graphify-Labs/graphify`; generic entry `graphify/skill.md`, plus
the installed host entry and sidecars as applicable. CLI package is `graphifyy`,
not an arbitrary similarly named package.

Check coverage and material freshness of existing `graphify-out/` or the configured
location. Prefer a scoped query/path/explanation for a structural question, then
read original sources. Batch updates when topology materially changes. No graph
refresh for each local fix; no full-corpus semantic ingestion for a narrow bug.

**Explicit overrides to upstream automation:** do not run global upgrades,
`--break-system-packages`, shell-piped remote installers, automatic provider use,
parallel semantic subagents, watchers, hooks or server installation by default.
A single agent can do structural-only work and permitted inline analysis. Before
execution inspect the installed command/help and backend behavior. A provider key
being set is not an authorization. Record external data flow and obtain the
existing required authority before any paid/remote semantic pass.

Use only real commands supported by the installed revision; `graphify query`,
`path` and `explain` are source-documented families, not proof of availability.
For no graph/tool, inspect source/callers/imports with available tools, label the
result manual/degraded and continue eligible work. Never fabricate graph nodes or
assert graph completeness, runtime behavior, or architecture acceptance from an
inferred edge. A material graph-derived architecture invariant needs a real sensor.

## Built-in additional skills, without another dependency collection

`DEBUG_REVIEW.md` provides two local methods:

1. Evidence-driven debugging: one falsifiable hypothesis, a bounded diagnostic,
   positive/negative controls where relevant, outcome, rollback and next decision.
2. Contract/diff review: meaningful assertions, real boundaries, ownership, data
   lifecycle, capability changes, performance limits and evidence provenance.

These are original workflow protocols, not claims that another named third-party
skill was installed. Add ecosystem-specific skills only for a demonstrated need,
with a recorded source, permission review and compatibility check. Do not install
an entire skill marketplace bundle.
