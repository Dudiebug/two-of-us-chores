---
name: repo-workflow
description: Use for repository implementation, tests, debugging, review, workflow adoption, or resuming a development task. Single-agent execution by default, with optional bounded delegation and evidence-scaled verification.
---

# Repo engineering workflow

Read `.agents/workflow/WORKFLOW.md`, the canonical profile and the applicable root
or nested repository instructions. Read `.agents/workflow/SKILLS.md` for composition
with actual Old Coder, Ponytail and Graphify definitions. Paths are repository-root
relative; determine the root rather than relying on the shell's current directory.

The primary agent performs the complete inspect/contract/implement/check/repair/
review/deliver loop. Use existing runners, evidence and architecture. Do not
require named models or another agent. Delegate only through supported tools and
`.agents/workflow/DELEGATION.md`. If unavailable, execute the task serially.

For “implement the workflow”, follow the supplied `IMPLEMENT_WORKFLOW.md`; after
installation ordinary tasks should use this entry without repeated setup. Keep
small fixes small. Preserve safety/authority and truthful outcomes; do not weaken
required gates. Loading this Markdown is guidance, not an executable test or
permission enforcement mechanism.
