#!/usr/bin/env python3
"""Validate workflow bindings structurally. Never execute sensors or accept a product."""
from __future__ import annotations

import argparse
import json
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import sys
from typing import Any

CORE_VERSION = "3.0.0"
AVAILABILITY = {"AVAILABLE", "UNAVAILABLE", "UNVERIFIED"}
KINDS = {"workflow", "compile", "static", "unit", "integration", "architecture",
         "runtime", "performance", "security", "human"}
EFFECTS = {"read_only", "local_check", "build", "disposable_runtime",
           "human_runtime", "privileged"}
PLACEHOLDER = re.compile(r"<[^>]+>|__SET_ME__|replace-with-|path/to/", re.I)


def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def reject_constant(value: str) -> None:
    raise ValueError(f"nonstandard JSON constant: {value}")


def load_json(path: Path) -> Any:
    """Read strict UTF-8 JSON, rejecting duplicate keys and NaN/Infinity."""
    return json.loads(path.read_text(encoding="utf-8"),
                      object_pairs_hook=reject_duplicates, parse_constant=reject_constant)


def validate_profile(data: Any, root: Path, allow_unconfigured: bool = False) -> list[str]:
    """Return structural errors only; declarations are not execution evidence."""
    errors: list[str] = []
    root = root.resolve()

    def fail(where: str, message: str) -> None:
        errors.append(f"{where}: {message}")

    def mapping(value: Any, where: str) -> dict[str, Any]:
        if not isinstance(value, dict):
            fail(where, "expected object")
            return {}
        return value

    def sequence(value: Any, where: str) -> list[Any]:
        if not isinstance(value, list):
            fail(where, "expected array")
            return []
        return value

    def text(value: Any, where: str, placeholders: bool = True) -> bool:
        if not isinstance(value, str) or not value.strip():
            fail(where, "expected nonempty string")
            return False
        if placeholders and PLACEHOLDER.search(value):
            fail(where, "unresolved placeholder")
            return False
        return True

    def choice(value: Any, choices: set[str], where: str) -> None:
        if not isinstance(value, str) or value not in choices:
            fail(where, "expected one of " + ", ".join(sorted(choices)))

    def contained(value: Any, where: str, directory: bool = False) -> None:
        if not text(value, where):
            return
        posix, windows = PurePosixPath(value), PureWindowsPath(value)
        if "\\" in value or posix.is_absolute() or windows.drive or ".." in posix.parts:
            fail(where, "use a contained repository-relative path with / separators")
            return
        path = (root / value).resolve()
        if not path.is_relative_to(root):
            fail(where, "resolved path escapes repository")
        elif not path.exists():
            fail(where, "path does not exist")
        elif directory and not path.is_dir():
            fail(where, "expected directory")

    data = mapping(data, "profile")
    if type(data.get("schema_version")) is not int or data.get("schema_version") != 1:
        fail("schema_version", "expected integer 1")
    if data.get("core_version") != CORE_VERSION:
        fail("core_version", f"expected {CORE_VERSION}")
    state = data.get("adoption_status")
    choice(state, {"UNCONFIGURED", "CONFIGURED"}, "adoption_status")
    configured = state == "CONFIGURED"
    if not configured and not allow_unconfigured:
        fail("adoption_status", "template is not adopted; --allow-unconfigured is template-only")

    repo = mapping(data.get("repository"), "repository")
    if configured:
        for key in ("identity", "inspected_ref"):
            text(repo.get(key), "repository." + key)
        contained(repo.get("strategy_path"), "repository.strategy_path")
        instructions = sequence(repo.get("instruction_paths"), "repository.instruction_paths")
        if not instructions:
            fail("repository.instruction_paths", "at least one actual entry point is required")
        for path in instructions:
            contained(path, "repository.instruction_paths")
        for key in ("source_roots", "test_roots"):
            for path in sequence(repo.get(key), "repository." + key):
                contained(path, "repository." + key, directory=True)

    execution = mapping(data.get("execution"), "execution")
    choice(execution.get("mode"), {"single", "optional_multi"}, "execution.mode")
    delegation = mapping(execution.get("delegation"), "execution.delegation")
    enabled = delegation.get("enabled")
    if type(enabled) is not bool:
        fail("execution.delegation.enabled", "expected boolean")
    count = delegation.get("max_helpers")
    if type(count) is not int or count < 0:
        fail("execution.delegation.max_helpers", "expected nonnegative integer")
    if execution.get("mode") == "single" and (enabled is not False or count != 0):
        fail("execution.delegation", "single mode cannot enable helpers")
    tools = sequence(delegation.get("supported_tools"), "execution.delegation.supported_tools")
    for tool in tools:
        text(tool, "execution.delegation.supported_tools")
    if enabled is True and (not tools or type(count) is not int or count < 1):
        fail("execution.delegation", "enabled delegation needs a tool binding and positive bound")
    if delegation.get("recursive") is not False:
        fail("execution.delegation.recursive", "recursive delegation is not supported")
    if delegation.get("integration_owner") != "primary_agent":
        fail("execution.delegation.integration_owner", "primary agent must own integration")
    repairs = execution.get("repair_replan_after")
    if type(repairs) is not int or repairs < 1:
        fail("execution.repair_replan_after", "expected positive integer")

    review = mapping(data.get("review"), "review")
    if review.get("no_independence_claim_from_self_review") is not True:
        fail("review", "self-review cannot be labeled independent")
    if type(review.get("independent_required")) is not bool:
        fail("review.independent_required", "expected boolean")
    if review.get("independent_required") is True:
        text(review.get("independent_requirement_source"), "review.independent_requirement_source")

    permissions = mapping(data.get("permissions"), "permissions")
    for key in ("allowed_local_operations", "requires_explicit_authorization", "prohibited_operations"):
        sequence(permissions.get(key), "permissions." + key)

    environments: set[str] = set()
    for i, value in enumerate(sequence(data.get("environments"), "environments")):
        where = f"environments[{i}]"
        env = mapping(value, where)
        name = env.get("id")
        if text(name, where + ".id"):
            if name in environments:
                fail(where, "duplicate environment ID")
            environments.add(name)
        choice(env.get("availability"), AVAILABILITY, where + ".availability")

    names: set[str] = set()
    for i, value in enumerate(sequence(data.get("skills"), "skills")):
        where = f"skills[{i}]"
        skill = mapping(value, where)
        name = skill.get("name")
        if text(name, where + ".name"):
            if name in names:
                fail(where, "duplicate skill name")
            names.add(name)
        choice(skill.get("definition_status"), AVAILABILITY | {"REFERENCED"}, where + ".definition_status")
        choice(skill.get("runtime_status"), AVAILABILITY | {"NOT_REQUIRED"}, where + ".runtime_status")
        text(skill.get("fallback"), where + ".fallback", placeholders=False)
        if skill.get("definition_status") == "AVAILABLE":
            text(skill.get("entry_reference"), where + ".entry_reference")
            text(skill.get("actual_revision"), where + ".actual_revision")
    if not {"old-coder", "ponytail", "graphify"}.issubset(names):
        fail("skills", "all three named skill integrations must be recorded")

    graph = mapping(data.get("graph"), "graph")
    if graph.get("mode") != "structural_or_current_agent_only":
        fail("graph.mode", "use structural_or_current_agent_only in this core")
    if graph.get("authority") != "advisory":
        fail("graph.authority", "graph output is advisory, not acceptance")
    # These flags intentionally stay off in this core. An authorized policy revision
    # must also revise the checker rather than silently accepting a contradictory mode.
    for key in ("external_semantic_calls", "background_watch", "automatic_hooks"):
        if graph.get(key) is not False:
            fail("graph." + key, "not enabled by this workflow core")

    sensor_ids: set[str] = set()
    sensors = sequence(data.get("sensors"), "sensors")
    if configured and not sensors:
        fail("sensors", "configured adoption needs an actual check/observation binding")
    for i, value in enumerate(sensors):
        where = f"sensors[{i}]"
        sensor = mapping(value, where)
        name = sensor.get("id")
        if text(name, where + ".id"):
            if name in sensor_ids:
                fail(where, "duplicate sensor ID")
            sensor_ids.add(name)
        choice(sensor.get("kind"), KINDS, where + ".kind")
        choice(sensor.get("owner"), {"agent", "human"}, where + ".owner")
        choice(sensor.get("effects"), EFFECTS, where + ".effects")
        choice(sensor.get("availability"), AVAILABILITY, where + ".availability")
        for key in ("measures", "pass_condition", "limitations", "evidence_output"):
            text(sensor.get(key), where + "." + key)
        sequence(sensor.get("prerequisites"), where + ".prerequisites")
        contained(sensor.get("cwd"), where + ".cwd", directory=True)
        contained(sensor.get("binding_reference"), where + ".binding_reference")
        if not isinstance(sensor.get("environment"), str) or sensor["environment"] not in environments:
            fail(where + ".environment", "unknown environment ID")
        binding = sensor.get("binding_type")
        choice(binding, {"command", "tool", "human"}, where + ".binding_type")
        if binding == "command":
            argv = sequence(sensor.get("command"), where + ".command")
            if not argv:
                fail(where + ".command", "empty command is not a check")
            for arg in argv:
                text(arg, where + ".command")
            if sensor.get("owner") != "agent":
                fail(where + ".owner", "human observations use a human binding")
        elif binding == "tool":
            text(sensor.get("tool_name"), where + ".tool_name")
            mapping(sensor.get("arguments"), where + ".arguments")
            if sensor.get("owner") != "agent":
                fail(where + ".owner", "human observations use a human binding")
        elif binding == "human":
            checklist = sequence(sensor.get("checklist"), where + ".checklist")
            if not checklist:
                fail(where + ".checklist", "nonempty action/expected-result checklist required")
            for action in checklist:
                text(action, where + ".checklist")
            if sensor.get("owner") != "human" or sensor.get("effects") != "human_runtime":
                fail(where, "human binding requires human owner and human_runtime effects")
            if sensor.get("kind") not in {"human", "runtime"}:
                fail(where + ".kind", "human binding requires human/runtime kind")
            if sensor.get("command") or sensor.get("tool_name"):
                fail(where, "human binding must not embed an executable binding")

    profiles = mapping(data.get("profiles"), "profiles")
    for name, ids in profiles.items():
        selected = sequence(ids, "profiles." + name)
        seen: set[str] = set()
        for sensor_id in selected:
            if not isinstance(sensor_id, str) or sensor_id not in sensor_ids:
                fail("profiles." + name, "unknown sensor ID")
            elif sensor_id in seen:
                fail("profiles." + name, "duplicate sensor ID")
            else:
                seen.add(sensor_id)

    evidence = mapping(data.get("evidence"), "evidence")
    if evidence.get("no_automatic_acceptance") is not True:
        fail("evidence", "a checker cannot automatically accept the task/product")
    if configured and evidence.get("runner_reference") is not None:
        contained(evidence["runner_reference"], "evidence.runner_reference")
    readiness = mapping(data.get("readiness"), "readiness")
    for key in ("bindings", "representative_repo_check", "skill_definitions", "host_entry_point"):
        choice(readiness.get(key), {"PASS", "FAIL", "UNVERIFIED", "PENDING", "NOT_APPLICABLE"}, "readiness." + key)
    sequence(readiness.get("blockers"), "readiness.blockers")
    refs = sequence(readiness.get("evidence_references"), "readiness.evidence_references")
    if any(readiness.get(key) == "PASS" for key in ("bindings", "representative_repo_check", "skill_definitions", "host_entry_point")) and not refs:
        fail("readiness.evidence_references", "PASS declarations need an evidence reference; contents still require review")
    for ref in refs:
        contained(ref, "readiness.evidence_references")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--allow-unconfigured", action="store_true", help="Validate the blank template only, not adoption readiness")
    args = parser.parse_args(argv)
    try:
        profile = load_json(args.root / ".agents/workflow/PROFILE.json")
        errors = validate_profile(profile, args.root, args.allow_unconfigured)
    except (OSError, UnicodeError, ValueError, RecursionError) as exc:
        print(f"Workflow configuration INVALID: {exc}", file=sys.stderr)
        return 2
    if errors:
        print("Workflow configuration INVALID:", file=sys.stderr)
        for error in errors:
            print("- " + error, file=sys.stderr)
        return 1
    print("Workflow configuration structurally valid. Product checks executed: 0. No acceptance claim.")
    if profile["adoption_status"] == "UNCONFIGURED":
        print("Template only: repository adoption is still UNCONFIGURED.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
