# Domain mapping prompts, not preconfigured sensors

Use only relevant sections during adoption. Commands, versions and statuses must
come from the target repository. These are requirements to investigate, not claims
that a test or tool exists.

## Games, mods and binary integration

Identify the real runtime branch, engine/game/mod-loader build, authored versus
generated code, stock versus mod-owned responsibilities, client/server authority,
UObject or equivalent thread rules, native/ABI guard policy and asset provenance.
Keep contract doubles, build success, actual engine networking, input/ownership,
visual body state, combat and soak/reconnect acceptance separate. Correct actor
roots do not prove a visible skeleton or physical simulation is correct. A new
native binary may require fresh startup acceptance before downstream clients.

Respect human-owned game tests, including headless GameTests and restart probes
where the repo assigns them to the human. Give the matching artifact and checklist;
do not silently launch runtime merely because a command's name contains 'test'.

## Stateful services and databases

Use disposable resources of the actual engine for meaningful integration. Check
migration/rollback, transaction boundaries, crash/retry behavior, isolation,
idempotency, authorization and schema/version compatibility as applicable. Mock
storage tests cannot demonstrate durability after a real process restart. Never
point tests at live customer data or migrate production during workflow setup.

## Libraries, APIs and protocols

Inventory supported consumers/platforms and existing compatibility checks.
Observe validation, serialization, ordering, size limits, cancellation, auth and
error contracts. A class existing or RPC flag being set does not prove behavior.
Choose version-matrix checks only for the affected support claims. Separate
published-package compatibility from development-tree tests.

## CLI, scripts, systems and devices

Check quoting, exit propagation, platform paths, dry-run behavior, idempotence,
permissions, ownership-scoped process cleanup and bounded execution. A read-only
status tool can still disclose secrets; collect only needed context. Hardware
requires real calibration/observation where material, not perfect simulated inputs.
No global system changes or live-device operations during unapproved setup.

## Web and UI

Reuse the actual build/unit/browser/accessibility tooling. Validate affected
interactions and rendered states when the change claims visual behavior. Pure
logic tests do not prove layout, keyboard access or focus handling. Use controlled
fixtures without production credentials. Screenshots alone do not prove backend
semantics or authorization. Keep visual and behavioral gates distinct.
