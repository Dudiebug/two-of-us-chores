# Workflow adoption result

## Publication task: settings gear and native LXC documentation — 2026-09-12

User approved the icon correction, documentation, native deployment support, and
commit/push of the completed application to `Dudiebug/two-of-us-chores`, `main`.
The source candidate includes the earlier app/workflow changes; no live deployment
was performed. The gear uses a centered symmetric eight-tooth outline and retains
the 44px accessible button. Documentation now covers everyday use, native Node 24
inside a Debian LXC, existing HTTPS proxy/firewall requirements, protected service
configuration, push keys, backup, upgrade and recovery. `LISTEN_HOST` preserves the
Docker default while allowing an explicit native address. Local commands explicitly
load `.env` and document local writable paths.

Verification: PASS, `pnpm test`, Node 24.21.0, 37 tests (0 failures/skips), including
two actual child-process startup checks for env-file loading and explicit/default
listen addresses. PASS, browser verification: 38 checks; corrected icon inspected
in phone light/dark and desktop screenshots. PASS, Bash syntax validation of all 16
shell blocks in README/Proxmox guide; this does not execute those operations.
PASS, workflow validator, modified-JS syntax and Git whitespace checks. Official
Node 24.21.0 checksum URL returned HTTP 200. No new application dependencies.

Service validation: the exact unit reached only a missing `/usr/local/bin/node`
diagnostic on this workstation, where Node is installed elsewhere. A temporary
copy with only ExecStart's Node path adapted passed `systemd-analyze verify`.
The original unit requires the documented LXC runtime installation; actual Debian
LXC/systemd startup, proxy reachability and real-device push remain UNVERIFIED here.
Sandbox socket restrictions initially prevented systemd checks; an isolated Bash
syntax-check process stalled and was stopped, then the bounded check passed with
normal subprocess access. No service was installed or started on the workstation.

Publishing hygiene: ignored Python bytecode caches, replaced the workstation-specific
browser command with portable placeholders, and checked publishable files for private
key/token patterns and home-directory paths. Environment templates contain examples
only. GitHub identity was verified; commits use the account's existing no-reply
identity without changing global Git settings. Prior task outcomes below are historical.

## Completed task: B Agenda UI and Undo — 2026-09-12

Status: COMPLETE for local implementation and verification. User explicitly approved
the B Agenda plan before implementation. Earlier sections below retain historical
adoption evidence; they do not describe the current Node runtime or test outcome.

Contract delivered: original teal B Agenda styling across Today, Calendar, History,
login, settings, forms and system states; native square checkboxes with 44px label
targets; mobile bottom navigation and floating add; desktop navigation at 768px;
safe Undo in the timed completion message and persistent History eligibility.
The login security footnote is absent. Four themes, recurrence, PWA/login boundaries,
and existing deployment architecture are preserved.

Implementation owns the UI assets, completion/Undo API and SQLite migration,
associated tests, browser verification script, screenshots, and this record.
Pre-existing dirty changes were preserved; no commit, push, deployment, live database
write, or new production dependency was performed. Tests use temporary/in-memory data.

Ponytail: reused native controls/dialogs, existing routing, SQLite transactions,
SSE, notifications, and theme controls; replaced obsolete calendar CSS with the
approved layout. Old Coder: high-risk restoration cases were specified and nine
initial Undo regressions were observed failing before implementation, then passing.
Repository proportional-verification rules were used, not the full upstream
coverage/mutation/toolchain gauntlet. This is a self-review, not independent review.

Failure model checked: duplicate or concurrent restoration, overwriting subsequent
edits/completions/deletion/rollover, partial database writes, ID reuse, legacy data,
restart/backup loss, unauthorized/cross-origin writes, and post-commit push failure.
The snapshot stays private. Database triggers invalidate Undo inside the owning
write transaction; a shared server predicate controls both eligibility and execution.

| Check | Current evidence |
| --- | --- |
| Baseline | Node 24.21.0: 22/22 tests passed with local listener access. Restricted execution could not exercise HTTP test files. |
| Test-first Undo | Nine tests failed on missing completion IDs before implementation; all nine passed afterward. |
| Product suite | PASS: `node --test --test-reporter=spec`, 35 tests, 35 passed, 0 failed/skipped. Includes HTTP/SSE, migration, restart, backup, recurrence, push failure and rollback cases. |
| Browser | PASS: `node tools/verify-ui.mjs` with Playwright 1.57.0 and Chromium 143.0.7499.4; 38 checks, 320/390/768/1280px widths plus a short 460px viewport. |
| Browser scenarios | Login and visibility toggle, no private fetch before login, navigation, date-strip selection/focus, all four themes, long titles, square controls/44px targets, completion, toast and History Undo, hover/focus timer pause and ten-second expiry, Escape/focus return, short-viewport form actions, offline write disablement, refresh recovery and logout. No uncaught browser errors. |
| Check integrity | Injecting a 4000px-wide body caused the layout checker to reject the known-bad fixture; the style was removed before normal checks. |
| Visual review | Directly inspected saved light/dark/pink Calendar, 320px layout, edit sheet, Settings, History and completion-message screenshots. Artifacts: `design/verification/`. |
| Syntax/diff | PASS: `node --check` for modified application JS modules; `git diff --check`. |
| Workflow | PASS: `python3 .agents/workflow/tools/validate_workflow.py --root .`; structural validation only. |

Corrections during verification: updated old exact-response assertions for approved
`completionId`/`canUndo` additions and markup assertions for the new owner-label and
checkbox design. Fixed an existing integration-test port reservation race after
EADDRINUSE by binding directly to port zero. Corrected a browser-test date selection
to navigate into the next week first. No behavior expectations were weakened.
The frontend now reads the server's actual household date/timezone fields and
retains keyboard focus across agenda refreshes. Notification delivery failure is
logged without falsely reporting a failed database mutation.

Reproduction on this workstation:

```sh
node --test --test-reporter=spec
PLAYWRIGHT_BROWSERS_PATH=/path/to/browser-cache PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/verify-ui.mjs
python3 .agents/workflow/tools/validate_workflow.py --root .
git diff --check
```

Limits: browser tests use Chromium emulation, not physical devices; the short
viewport approximates keyboard space but does not prove iOS keyboard behavior.
Device PWA installation, real browser-push delivery, container persistence and
Proxmox deployment remain PENDING at their existing human/deployment boundary.
Docker checks are NOT_APPLICABLE to this local UI delivery; no container config was
changed by this task. Coverage/mutation tools were not added or claimed. Old history
cannot be reversed without snapshots. Before deployment, back up the database;
rollback requires the previous app and its matching pre-migration backup.

## Historical workflow adoption

Actual repository/branch/candidate: `two-of-us-chores`, branch `main`, base commit
`9f7ac42e3289568782d1978e66d70cb6b0d5219e`, with pre-existing uncommitted product
changes preserved in place.

Files integrated (not merely proposed): the reviewed Repo Engineering Workflow
v3.0.0 repository overlay under `.agents/`, a managed `AGENTS.md` entry point,
`EXECUTION_STRATEGY.md`, and this repository-specific configured profile/report.

Existing policy/tooling preserved: `package.json` remains the product test entry
point (`pnpm test`), `README.md` remains the deployment/runtime checklist, and no
product source, tests, dependencies, Git history, branch, hooks, credentials or
provider configuration were changed by workflow adoption.

Conflicts reconciled within authorized workflow scope: no prior repository
`AGENTS.md`, `EXECUTION_STRATEGY.md`, `.agents/` workflow, independent-review rule,
or separate evidence runner existed. The local workstation has Node 26.7.0 while
the project declares Node `>=24 <25`; local test evidence is therefore explicitly
qualified. Docker is not installed on this workstation, so Compose checks are
configured but unavailable here.

Canonical entry points and record locations: `AGENTS.md` ->
`EXECUTION_STRATEGY.md` -> `.agents/workflow/WORKFLOW.md` with concrete bindings in
`.agents/workflow/PROFILE.json`. The repository has no pre-existing canonical task
or evidence tracker; durable task records should use one concise record based on
the included templates when needed.

Single-agent path and optional delegation: single primary agent. Delegation is
disabled in the profile and remains optional rather than required.

| Skill | Actual definition / revision | Runtime status | Fallback / unresolved setup |
| --- | --- | --- | --- |
| Old Coder | Native `old-coder`; `sha256:839a3a2a09708f7be5cd56287c6d076412413467cc63560185a4beb41377ef19` | Instruction definition available; separate runtime not required | Bundled Old Coder-informed proportional verification policy |
| Ponytail | Native `ponytail`; `sha256:1316a2f3f95741d2300b116fe0c2d81ce4a9568656ed0a62643f54aaf09957f2` | Instruction definition available; separate runtime not required | Bundled minimal-correct-implementation policy |
| Graphify | Native `graphify`; skill `sha256:3898b1042721cad27d6f87ca44f638415a7f763203aefd86b90f9358ffea3a43`; CLI 0.9.58 | CLI available; no graph exists yet | Targeted source/caller/import inspection, labeled degraded when graph operations are unavailable |

| Sensor | Existing real binding | Owner / scope | Execution and evidence |
| --- | --- | --- | --- |
| `workflow-validate` | `python3 .agents/workflow/tools/validate_workflow.py --root .` | Agent / workflow structure | PASS: reported `Workflow configuration structurally valid. Product checks executed: 0. No acceptance claim.` |
| `product-tests` | `pnpm test` | Agent / current Node test suite | FAIL on this host: 8 test files ran, 5 passed and 3 failed. `backend.test.mjs` and `integration.test.mjs` are blocked by sandbox `listen EPERM` on `127.0.0.1`; `backup.test.mjs` reaches an assertion failure because captured backup-CLI stdout is empty where `backup.db` is expected. Node 26.7.0 is also outside the supported Node 24.x engine range, so rerun under Node 24 before treating the backup result as production-runtime evidence. |
| `compose-config` | `docker compose config` | Agent / deployment config | UNVERIFIED here: Docker unavailable |
| `compose-build` | `docker compose build` | Agent / container build | UNVERIFIED here: Docker unavailable |
| `deployed-pwa-runtime` | Manual checklist in `README.md` and profile | Human / deployed browser + Proxmox boundary | PENDING until a deployed candidate is exercised |

Validation actually performed: all files in the supplied ZIP matched
`MANIFEST.sha256`. The kit's validator test suite executed 45 tests with 45
passing, 0 failures, 0 errors and 0 skips. The configured repository validator
passes structurally. The representative product suite was also executed; its
current result is 5 passing test files and 3 failing test files, with the failure
classification recorded in the sensor table above. This is not a product
acceptance claim.

Second-adoption/idempotence check: the managed `AGENTS.md` section has one begin
marker and one end marker, the configured profile remains `CONFIGURED`, and the
workflow validator is read-only with respect to that configured profile. A repeat
adoption must update the managed section in place and preserve the configured
profile rather than append a second managed block or restore the blank template.

Unrelated changes preserved: all product-file modifications and untracked PWA/login
assets that existed before adoption remain untouched.

Remaining blockers by scope: rerun the product suite under supported Node 24.x in
an environment that allows localhost listeners; investigate/recheck the backup CLI
stdout assertion there; local Docker checks; and deployed PWA/Web Push/Proxmox
runtime observations.

Next practical product verification: rerun `pnpm test` under Node 24.x outside the
restricted sandbox, then run the configured Docker and deployed-PWA milestone
checks at their actual boundaries.

Distinguish files integrated, bindings configured, checks executed and target
behavior verified. Structural validator success alone certifies none of the last
three beyond the particular structural properties it actually checks.
