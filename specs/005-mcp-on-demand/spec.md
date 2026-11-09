# Feature Specification: MCP Tools on Demand

**Feature Branch**: `feat/memory-efficiency` | **Created**: 2026-11-08 | **Status**: Implemented

**Input**: item 1 of the platform list (2026-11-08): load MCP tools only when needed. Tucano defers MCP
tools behind a tool search (239k → 11k tokens); OpenBot "Defers Codex MCP tools" (idea only).

## Baseline

Every tool of every connected MCP server is listed in every request of every turn. A few servers with
dozens of tools cost thousands of tokens per request, whatever the task.

## User Story 1 - Many connected services don't cost tokens until used (P1)

**Independent Test**: with a server of 82 tools, the turn lists `zorel_find_tools` and `zorel_use_tool`
instead of them; a search finds the right tool; calling it goes through the same routes, approvals,
outside-text warning and large-result shortening; an unknown name is a tool error.

## Requirements

- **FR-001**: When the connected MCP servers' tool definitions exceed 10,000 characters (~2.5k tokens),
  the turn MUST list two internal tools instead of them: find (by words in name and description) and use.
- **FR-002**: A tool called through `zorel_use_tool` MUST follow exactly the path of a listed tool
  (permissions, approvals, warnings, shortening).
- **FR-003**: Under the threshold, nothing changes.

## Success Criteria

- **SC-001**: 82 tools: 21,181 → 625 characters of definitions per request (−97%).
- **SC-002**: Every existing test green; the MCP approval tests unchanged.

## Tasks

- [X] T001 `apps/server/src/team.ts`: `MCP_DEFER_CHARS`, `FIND_TOOLS_TOOL`, `USE_TOOL_TOOL`, `findTools`
- [X] T002 `apps/server/src/runtime.ts`: collect MCP definitions, defer past the threshold, route find/use
- [X] T003 `apps/server/src/main.test.ts`: fake server with 80 extra tools; list, find, use, unknown name
- [X] T004 Record in `docs/ARCHITECTURE.md` §9, `.agent/memory/server.md`, changelog

## Results (2026-11-08)

SC-001 met (21,181 → 625 characters for 82 tools). 259 server tests green.
