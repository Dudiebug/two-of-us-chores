# Map the generic profile to a real repository

`PROFILE.json` is descriptive, not executable host configuration. The core stays
generic; this file records actual repository conventions and bindings. Prefer an
existing canonical profile/runner when available. Do not add a competing tracker.

## Top-level mapping

- `adoption_status`: UNCONFIGURED initially; CONFIGURED after real bindings and
  policy mapping exist. It is **not** a product acceptance state.
- `repository`: identity, inspected ref, relative source/test/instruction paths,
  strategy, existing task/evidence locations, architecture and protected/generated
  boundaries. Paths may name real directories or files; use repo-relative form.
- `execution`: single by default, optional_multi only when intentionally enabled;
  supported tool names from the actual inventory. No recursive workers.
- `review`: self-review for ordinary tasks; preserve inherited independent gates
  with their source. `independent_required=false` in the empty template is not
  permission to remove a target repository's existing requirement.
- `permissions`: record existing allowed work and genuine authorization boundaries.
  This file cannot grant permission or enforce isolation.
- `environments`: objects with `id`, `description`, and `availability` as
  AVAILABLE / UNAVAILABLE / UNVERIFIED. Do not hardcode another machine's paths.
- `skills`: exact source/name, actual entry and revision; availability distinctions
  are defined in INSTALL_SKILLS.md. Do not label remote URLs installed. An entry
  may be a repo-relative file, a documented native skill ID, or a reference to
  ignored local config. The checker does not verify external skill access.
- `graph`: advisory; local/inline default; no automatic cloud/provider, agents,
  watches or hooks. A different policy requires actual authorization.
- `sensors`: each actual invocation/observation, defined below.
- `profiles`: named lists of sensor IDs; focused may be empty because the primary
  agent selects task-specific checks. Milestone lists the project's real due gates,
  not every available tool. Empty profiles never mean an acceptance PASS.
- `evidence` and `readiness`: actual runner/record, references and scoped blockers.
  Readiness claims require real evidence outside the structural checker.

## Sensor object

Required keys:

```json
{
  "id": "replace-with-real-sensor-id",
  "kind": "unit",
  "binding_type": "command",
  "binding_reference": "path/to/existing/runner-or-manifest",
  "command": ["actual-executable", "actual-argument"],
  "cwd": ".",
  "environment": "existing-environment-id",
  "owner": "agent",
  "effects": "local_check",
  "measures": "Specific observable criterion",
  "pass_condition": "Actual required work executed; no relevant failures",
  "limitations": "What this does not establish",
  "prerequisites": [],
  "availability": "UNVERIFIED",
  "evidence_output": "Actual output location or captured command log"
}
```

The example above is a schema illustration, **not** a configured runnable sensor.
The repository checker rejects placeholder values in configured bindings.

Kinds: workflow, compile, static, unit, integration, architecture, runtime,
performance, security, human. Owners: agent or human.
Effect classes: read_only, local_check, build, disposable_runtime, human_runtime,
privileged. These are review labels, not enforced permissions.

For `binding_type: tool`, use `tool_name` and `arguments` instead of command;
record the exact supported schema separately. A parser does not connect the tool.
For `binding_type: human`, owner must be human, kind human/runtime, effects
human_runtime, and `checklist` must be a nonempty list of actions/expected outcomes.
The binding reference points to its real checked-in checklist or contract.
No tool or shell command is executed by validation.

The checker requires binding_reference and cwd to be contained existing paths,
checks environment/profile references and basic fields, rejects empty command
arrays, placeholders, duplicate keys/IDs, unknown outcomes and mode contradictions.
It does not parse arbitrary build scripts, validate a tool's live schema, attest
to reviewer independence, or establish that a command actually ran nonempty tests.
An available sensor may still fail when executed. Human runtime is due, not a
working local executable.

## Minimal useful adoption

Map actual root/strategy/source paths, all three skill references and their true
status, one meaningful real product sensor where the project has executable work,
any required human/runtime check, and the existing milestone review/runner.
Run a permitted representative check and keep its evidence. A documentation-only
repository may use meaningful link/structure checks instead of inventing product
code. Missing required toolchains leave those checks UNVERIFIED.

Check the profile from the repository root:

```text
python .agents/workflow/tools/validate_workflow.py --root .
```

`--allow-unconfigured` is only for the untouched template, not a workaround for
incomplete adoption. A non-Git project can use another reconstructible source
identity. Avoid global per-file hashes where the repo intentionally uses scoped
finding/contract identity. Keep host-specific paths and secrets in ignored files.
