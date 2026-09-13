# Resolve the named skills without changing the machine unexpectedly

Prefer the installed skill. The registry is a reference, not proof of installation
and not an instruction to update to a moving default branch. The kit does not
bundle upstream skill bodies, dependencies, hook implementations or binaries.

## Definition path

1. Inspect the actual skill registry and permitted local instruction locations.
   Record existing origin/revision and read the relevant entry and sidecars.
2. If unavailable, use repository/file-fetch tools to read the exact registry
   commit and entry. For Graphify inspect the matching host entry and its reference
   paths. Do not blindly rename `graphify/skill.md` to `SKILL.md` and break its
   relative sidecars. Read installer source only to understand layout, not execute it.
3. Under repository policy, either reference an approved external installation or
   copy the reviewed instruction files and required license/NOTICE files to the
   chosen project-local skill directory. Preserve provenance and local changes.
   Repositories prohibiting vendored skill text must keep the reference approach.
4. Verify referenced sidecars actually exist, the entry is readable, and the host
   can explicitly load it. Auto-discovery is a separate check. Store machine-local
   absolute paths in ignored local configuration, not shared team settings.
5. Update `PROFILE.json` availability with a true status and evidence reference.
   Do not write `AVAILABLE` for a registry URL alone or after a failed fetch.

## Runtime path

Old Coder and Ponytail are instruction skills; their chosen tests still need the
repository's real toolchain. Graphify also needs its compatible CLI/dependencies
for graph operations. Instruction availability alone does not satisfy that.

Reuse permitted environments. Install/upgrade binaries, packages or toolchains
only within existing authorization, using the project-scoped dependency manager
and a reviewed pin/lock. Inspect the complete side-effect path first. Do not run
`npx ...@latest`, a bare upstream installer, `pip --break-system-packages`, global
hooks or provider changes as a shortcut to fetching Markdown.

For Graphify, inspect the installed help and exact backend selection before
binding local extraction/query commands. Explicitly preserve the single-agent
mode and external-data policy. Do not auto-select a cloud key found in the
environment. Use the manual mapping fallback if the required mode is unavailable.

## Upgrade and fallback

An installed revision need not match the reference pin. Review the difference,
retain a compatible installation and record the actual revision. Never claim
pinned parity from a version string alone. No silent downgrades or auto-updates.

Possible states: `AVAILABLE` (entry read/resolved), `REFERENCED` (source known but
not locally executable/loadable), `UNAVAILABLE` (checked and absent/failed), or
`UNVERIFIED` (not checked). Runtime availability is recorded separately as
AVAILABLE, UNAVAILABLE, UNVERIFIED or NOT_REQUIRED.

If a required named definition cannot be read, disclose that fact and apply the
bundled integration principles without claiming the upstream skill ran. This
permits useful work; it does not erase a requested skill-setup obligation.
