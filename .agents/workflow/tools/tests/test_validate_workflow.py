"""Self-contained checker tests; fixtures are not target-repository evidence."""
from __future__ import annotations

import contextlib
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("validate_workflow", TOOLS / "validate_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
# Frozen synthetic test data: adopting a real PROFILE.json must not change these tests.
TEMPLATE = json.loads((Path(__file__).parent / "fixtures/unconfigured-profile.json").read_text(encoding="utf-8"))


class WorkflowValidatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for path in ("AGENTS.md", "EXECUTION_STRATEGY.md", "tests/check.py", "evidence/result.txt"):
            dest = self.root / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text("fixture only\n", encoding="utf-8")
        (self.root / "src").mkdir()
        self.profile = deepcopy(TEMPLATE)
        self.profile["adoption_status"] = "CONFIGURED"
        self.profile["repository"].update(identity="fixture-repository", inspected_ref="fixture-commit",
            source_roots=["src"], test_roots=["tests"], strategy_path="EXECUTION_STRATEGY.md")
        self.profile["environments"] = [{"id": "local", "availability": "AVAILABLE", "description": "Fixture only"}]
        self.profile["sensors"] = [{"id": "unit", "kind": "unit", "binding_type": "command",
            "binding_reference": "tests/check.py", "command": ["python", "tests/check.py"],
            "cwd": ".", "environment": "local", "owner": "agent", "effects": "local_check",
            "measures": "Fixture binding structure", "pass_condition": "Actual nonempty checks pass",
            "limitations": "This fixture does not test a product", "prerequisites": [],
            "availability": "UNVERIFIED", "evidence_output": "captured command output"}]
        self.profile["profiles"] = {"focused": ["unit"], "milestone": ["unit"]}

    def errors(self):
        return module.validate_profile(self.profile, self.root)

    def rejects(self, text):
        self.assertTrue(any(text in error for error in self.errors()), self.errors())

    def test_valid_configured_binding(self):
        self.assertEqual(self.errors(), [])

    def test_template_requires_explicit_flag(self):
        self.assertTrue(module.validate_profile(deepcopy(TEMPLATE), self.root))
        self.assertEqual(module.validate_profile(deepcopy(TEMPLATE), self.root, True), [])

    def test_duplicate_json_keys_rejected(self):
        path = self.root / "bad.json"
        path.write_text('{"a":1,"a":2}')
        with self.assertRaisesRegex(ValueError, "duplicate"):
            module.load_json(path)

    def test_nonstandard_nan_rejected(self):
        path = self.root / "bad.json"
        path.write_text('{"value":NaN}')
        with self.assertRaisesRegex(ValueError, "nonstandard"):
            module.load_json(path)

    def test_malformed_json_returns_nonzero(self):
        dest = self.root / ".agents/workflow/PROFILE.json"
        dest.parent.mkdir(parents=True)
        dest.write_text('{broken')
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(module.main(["--root", str(self.root)]), 2)

    def test_missing_profile_returns_nonzero(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(module.main(["--root", str(self.root)]), 2)

    def test_schema_bool_is_not_integer_one(self):
        self.profile["schema_version"] = True
        self.rejects("schema_version")

    def test_wrong_core_version(self):
        self.profile["core_version"] = "2.0.0"
        self.rejects("core_version")

    def test_wrong_top_level_type_rejected(self):
        self.assertTrue(module.validate_profile([], self.root))

    def test_malformed_sections_return_errors_not_crash(self):
        for key in ["repository", "execution", "review", "permissions", "environments", "skills", "graph", "sensors", "profiles", "evidence", "readiness"]:
            with self.subTest(key=key):
                candidate = deepcopy(self.profile)
                candidate[key] = 7
                self.assertTrue(module.validate_profile(candidate, self.root))

    def test_duplicate_sensor_id(self):
        self.profile["sensors"].append(deepcopy(self.profile["sensors"][0]))
        self.rejects("duplicate sensor")

    def test_empty_command_rejected(self):
        self.profile["sensors"][0]["command"] = []
        self.rejects("empty command")

    def test_string_command_rejected(self):
        self.profile["sensors"][0]["command"] = "echo PASS"
        self.rejects("expected array")

    def test_placeholder_command_rejected(self):
        self.profile["sensors"][0]["command"] = ["python", "<test-path>"]
        self.rejects("unresolved placeholder")

    def test_numeric_command_argument_rejected(self):
        self.profile["sensors"][0]["command"] = ["python", 123]
        self.rejects("expected nonempty string")

    def test_unknown_environment_rejected(self):
        self.profile["sensors"][0]["environment"] = "missing"
        self.rejects("unknown environment")

    def test_duplicate_environment_rejected(self):
        self.profile["environments"] *= 2
        self.rejects("duplicate environment")

    def test_missing_binding_file_rejected(self):
        self.profile["sensors"][0]["binding_reference"] = "missing.py"
        self.rejects("path does not exist")

    def test_parent_escape_rejected(self):
        self.profile["sensors"][0]["cwd"] = "../outside"
        self.rejects("contained repository-relative")

    def test_windows_absolute_path_rejected_on_any_host(self):
        self.profile["sensors"][0]["cwd"] = "C:/work/project"
        self.rejects("contained repository-relative")

    def test_symlink_escape_rejected(self):
        with tempfile.TemporaryDirectory() as outside:
            try:
                (self.root / "escape").symlink_to(outside, target_is_directory=True)
            except (OSError, NotImplementedError) as exc:
                self.skipTest(f"Symlinks unavailable: {exc}")
            self.profile["sensors"][0]["cwd"] = "escape"
            self.rejects("escapes repository")

    def test_unknown_profile_sensor_rejected(self):
        self.profile["profiles"]["milestone"].append("imaginary")
        self.rejects("unknown sensor ID")

    def test_duplicate_profile_sensor_rejected(self):
        self.profile["profiles"]["focused"].append("unit")
        self.rejects("duplicate sensor ID")

    def test_single_mode_cannot_enable_agents(self):
        self.profile["execution"]["delegation"].update(enabled=True, max_helpers=1, supported_tools=["real_tool"])
        self.rejects("single mode cannot")

    def test_optional_multi_can_run_without_helpers(self):
        self.profile["execution"]["mode"] = "optional_multi"
        self.assertEqual(self.errors(), [])

    def test_optional_multi_bound_tool_required(self):
        self.profile["execution"]["mode"] = "optional_multi"
        self.profile["execution"]["delegation"].update(enabled=True, max_helpers=1)
        self.rejects("needs a tool binding")

    def test_valid_optional_multi(self):
        self.profile["execution"]["mode"] = "optional_multi"
        self.profile["execution"]["delegation"].update(enabled=True, max_helpers=2, supported_tools=["host_exact_tool"])
        self.assertEqual(self.errors(), [])

    def test_recursive_delegation_rejected(self):
        self.profile["execution"]["delegation"]["recursive"] = True
        self.rejects("recursive delegation")

    def test_independent_review_needs_requirement_source(self):
        self.profile["review"]["independent_required"] = True
        self.rejects("independent_requirement_source")

    def test_independence_cannot_be_fabricated(self):
        self.profile["review"]["no_independence_claim_from_self_review"] = False
        self.rejects("cannot be labeled independent")

    def test_named_skills_must_be_recorded(self):
        self.profile["skills"].pop()
        self.rejects("all three named")

    def test_available_skill_needs_actual_reference(self):
        self.profile["skills"][0]["definition_status"] = "AVAILABLE"
        self.rejects("entry_reference")

    def test_duplicate_skill_rejected(self):
        self.profile["skills"].append(deepcopy(self.profile["skills"][0]))
        self.rejects("duplicate skill")

    def test_graph_cannot_be_acceptance(self):
        self.profile["graph"]["authority"] = "acceptance"
        self.rejects("graph output is advisory")

    def test_automatic_external_semantics_rejected(self):
        self.profile["graph"]["external_semantic_calls"] = True
        self.rejects("not enabled")

    def test_no_sensors_is_not_configured_adoption(self):
        self.profile["sensors"] = []
        self.rejects("actual check/observation binding")

    def test_human_binding_requires_ownership_and_checklist(self):
        s = self.profile["sensors"][0]
        s.update(binding_type="human", kind="human", checklist=[])
        self.rejects("checklist required")
        self.rejects("human owner")

    def test_valid_human_binding(self):
        s = self.profile["sensors"][0]
        s.pop("command")
        s.update(binding_type="human", kind="human", owner="human", effects="human_runtime",
                 checklist=["Use the matching build; take the specified action; observe the expected state."])
        self.assertEqual(self.errors(), [])

    def test_tool_binding_requires_real_shape(self):
        s = self.profile["sensors"][0]
        s.pop("command")
        s.update(binding_type="tool", tool_name="host.sensor", arguments={})
        self.assertEqual(self.errors(), [])
        s["arguments"] = []
        self.rejects("expected object")

    def test_invalid_status_rejected(self):
        self.profile["readiness"]["representative_repo_check"] = "SKIPPED"
        self.rejects("representative_repo_check")

    def test_readiness_pass_without_artifact_reference_rejected(self):
        self.profile["readiness"]["bindings"] = "PASS"
        self.rejects("PASS declarations need")

    def test_missing_evidence_path_rejected(self):
        self.profile["readiness"]["evidence_references"] = ["not-there.txt"]
        self.rejects("path does not exist")

    def test_auto_acceptance_rejected(self):
        self.profile["evidence"]["no_automatic_acceptance"] = False
        self.rejects("automatically accept")

    def test_validator_never_executes_sensor_command(self):
        marker = self.root / "SHOULD_NOT_EXIST"
        self.profile["sensors"][0]["command"] = [sys.executable, "-c", f"open({str(marker)!r}, 'w').write('bad')"]
        dest = self.root / ".agents/workflow/PROFILE.json"
        dest.parent.mkdir(parents=True)
        dest.write_text(json.dumps(self.profile), encoding="utf-8")
        proc = subprocess.run([sys.executable, str(TOOLS / "validate_workflow.py"), "--root", str(self.root)],
                              capture_output=True, text=True, timeout=10)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("Product checks executed: 0", proc.stdout)
        self.assertFalse(marker.exists())

    def test_invalid_cli_returns_nonzero_and_error(self):
        self.profile["sensors"][0]["command"] = []
        dest = self.root / ".agents/workflow/PROFILE.json"
        dest.parent.mkdir(parents=True)
        dest.write_text(json.dumps(self.profile), encoding="utf-8")
        proc = subprocess.run([sys.executable, str(TOOLS / "validate_workflow.py"), "--root", str(self.root)],
                              capture_output=True, text=True, timeout=10)
        self.assertEqual(proc.returncode, 1)
        self.assertIn("empty command", proc.stderr)
        self.assertNotIn("structurally valid", proc.stdout)


if __name__ == "__main__":
    unittest.main()
