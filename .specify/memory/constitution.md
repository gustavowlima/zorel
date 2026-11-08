<!--
Sync Impact Report
- Version change: template → 1.0.0 (first ratification)
- Principles: I. Scope and Simplicity, II. Security (NON-NEGOTIABLE), III. Explicit Errors and
  Boundary Validation, IV. Cross-Platform, V. Language and Attribution
- Added sections: Architecture Constraints, Development Workflow, Governance
- Removed sections: none
- Source: derived only from /Volumes/Gustavo_SSD/AGENTS.md and .agent/memory/project.md
  conventions; no new rules introduced
- Templates: ✅ .specify/templates/plan-template.md (Constitution Check reads gates from this
  file, no edit needed) ✅ spec-template.md ✅ tasks-template.md (no principle-specific task types)
- Deferred TODOs: none
-->

# Zorel Constitution

## Core Principles

### I. Scope and Simplicity

- Understand the full scope before writing code; if a task is ambiguous, ask before assuming.
- Do not refactor outside the task scope; prefer editing existing code over creating new files.
- Do not install a dependency without stating why it is needed.
- Do not delete code without understanding why it exists.
- Small functions with a single responsibility; follow the style of the file being edited.
- Light first: one process, one database file, no mandatory external service; grow only with
  measurement.
- Deliver complete or do not deliver: no partial implementation. A temporary hack is marked
  `HACK:` with the reason.

Rationale: the codebase is maintained by successive agents without shared memory; unrequested
scope and silent shortcuts are what the next agent cannot reconstruct.

### II. Security (NON-NEGOTIABLE)

- Never commit secrets; use environment variables or the OS keychain.
- Input validation always runs on the server, even when the client also validates.
- Every authenticated route checks authorization, not only authentication.
- Never expose a stack trace to the client in production.
- Subscriptions always spawn the official CLI; Zorel never reads or stores its OAuth token.

### III. Explicit Errors and Boundary Validation

- Validate input at the application boundary, not in the middle of the code.
- Errors are explicit; an exception is never silenced without logging.

### IV. Cross-Platform

- Every feature works on Windows, macOS and Linux.
- Code that shells out to OS tools has a path per platform, and its parsers have unit tests with
  sample output from each OS.
- What could not be exercised live (CI and development run on macOS) is stated plainly.

### V. Language and Attribution

- Code, code comments and commit messages are in English.
- Every text sent to models (prompts, tool results, engine errors) is in English and never tells
  the model which language to reply in.
- UI text goes through `packages/i18n`; user content is not translated.
- No Claude attribution in commits, PR titles, PR bodies or PR comments.

## Architecture Constraints

- `packages/contracts` is the only source of types that cross the network.
- Naming is Zorel: packages `@zorel/*`, env `ZOREL_*`, tools `zorel_*`; legacy `zero` names are
  kept only where `.agent/memory/project.md` lists them.
- `docs/ARCHITECTURE.md` is the source of truth for decisions (D1–D20) and phases.

## Development Workflow

- Before a task: read `.agent/memory/index.md` and only the domain files whose keywords match.
- Before declaring done: run `bun run test`; check whether a new file needs an index, route or
  export entry; if an API contract changed, verify every consumer.
- Before declaring done: update the domain file in `.agent/memory/`, its index, and append to
  `.agent/memory/changelog/[domain].md` when a rule changed.
- The final report states what was done and what was left out of scope.

## Governance

This constitution restates the rules in `AGENTS.md` and `.agent/memory/project.md`; when they
conflict, those files win and this one is amended to match. Amendments follow semantic
versioning: MAJOR for a removed or redefined principle, MINOR for a new principle or section,
PATCH for wording. Every plan's Constitution Check verifies the principles above, and any
violation is justified in the plan's Complexity Tracking table.

**Version**: 1.0.0 | **Ratified**: 2026-11-08 | **Last Amended**: 2026-11-08
