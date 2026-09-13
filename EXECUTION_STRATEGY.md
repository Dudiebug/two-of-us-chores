# Execution strategy

The default executor is one primary agent performing the full development loop.
The generic loop is in `.agents/workflow/WORKFLOW.md`; concrete repository
bindings, environments, review boundaries and check availability are in
`.agents/workflow/PROFILE.json`.

For this project, intended behavior comes from the active user request, the
checked-in application contracts, and `README.md`. There is no separate product
plan, task tracker, evidence runner, or independent-review requirement currently
checked into the repository. For substantial work, keep one concise task/evidence
record using the templates under `.agents/workflow/templates/` when durable state
is useful; do not create parallel trackers for the same work.

Use `pnpm test` as the normal automated product check. The declared application
runtime is Node 24.x even if a development host can execute the suite on another
Node version; evidence from an unsupported Node version must say so. Deployment
work also requires the Docker Compose configuration/build checks from `README.md`
when Docker is available. Browser layout, PWA installation, Web Push delivery,
cross-session update behavior on real browsers, persistence across container
recreation, and Proxmox deployment remain runtime observations at their actual
boundaries rather than being inferred from unit tests.

Use focused task checks, meaningful regressions and honest evidence. Scale
verification to risk; auth, persistence, destructive data paths and public
deployment changes receive stronger verification than documentation or styling
changes. Optional helpers follow the same contracts. Do not silently change
authority, architecture, scope, tolerances, authentication boundaries or gate
ownership.
