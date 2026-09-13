<!-- repo-engineering-workflow:begin v3 -->
## Engineering workflow

Read the repository's execution strategy and `.agents/workflow/WORKFLOW.md` before
substantial changes; use `.agents/workflow/PROFILE.json` for real bindings. Reuse
context already read and inspect only affected contracts on small repairs.

Work directly as the primary agent: inspect, specify, implement, test, repair,
review and deliver. Delegation is optional, supported-tool-only and bounded by
`.agents/workflow/DELEGATION.md`. No model-specific split or manual courier is
required. Follow `.agents/workflow/SKILLS.md`: Ponytail for implementation,
Old Coder-informed proportional testing, Graphify for useful structural work,
and the integrated root-cause/debug/review protocols.

Use focused checks and existing runners. Never weaken requirements or valid tests
to obtain green. Distinguish PASS/FAIL/UNVERIFIED/PENDING/NOT_APPLICABLE and task
completion from milestone acceptance. Self-review is not independent verification.
Preserve human runtime ownership, architecture, current changes, host permissions
and required milestone gates. Keep one concise durable evidence record.
<!-- repo-engineering-workflow:end -->
