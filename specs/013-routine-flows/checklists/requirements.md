# Specification Quality Checklist: Routine Flows

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-10
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- The only technology named is the canvas library. It appears in Assumptions as a decision the person already made
  (2026-11-10), not in the requirements, which stay neutral ("a canvas and a list view").
- Defaults chosen without asking (each listed in Assumptions):
  - at most 30 steps;
  - no loops or parallel branches;
  - conditions from a fixed set of checks, with no expression language;
  - retries 1 by default, up to 3;
  - the "Ask me" limit is the existing 30 min.
- Stories: P1 = 1–3 (the editor, tool steps, durable runs), P2 = 4–6 (triggers, connector delivery,
  branch/ask/end). A first delivery can be P1 only, with linear flows.
