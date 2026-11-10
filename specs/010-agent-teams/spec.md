# Feature Specification: Agent Teams

**Feature Branch**: `feat/browser-cursor-review` | **Created**: 2026-11-10 | **Status**: Implemented

**Input**: "quero implementar o conceito de times nos agentes basicamente posso agrupar por times dessa forma posso
referenciar time tbm adicionar times inteiros inclusive na parte de criar posso colocar como time" (2026-11-10).
Today a chat's members are picked one agent at a time (header picker, `@`/`#` in the composer, "Add to chat"), and
an agent is called by `@handle`. There is no way to name a group of agents and use it as one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Group agents into a team (Priority: P1)

The person creates a team ("Frontend", "Review crew"), gives it a name and a handle, and picks which agents belong to
it and in which order. They can rename it, change its members, and delete it. Deleting a team never deletes its agents.

**Why this priority**: Every other story needs teams to exist.

**Independent Test**: Create a team with three agents on the Agents page, reload, and it is still there with the same
members in the same order. Delete it; the three agents are untouched.

**Acceptance Scenarios**:

1. **Given** a project with agents A, B, C, **When** the person creates team "Frontend" with A and C, **Then** the
   Agents page shows the team with A and C, in that order.
2. **Given** team "Frontend", **When** the person removes C and adds B, **Then** the team shows A and B.
3. **Given** team "Frontend", **When** it is deleted, **Then** A, B and C still exist and still work in their chats.
4. **Given** a team handle already used by an agent or another team in the same reach, **When** the person saves,
   **Then** they are told the handle is taken and nothing is saved.

---

### User Story 2 - Add a whole team to a chat (Priority: P1)

Wherever the person adds agents to a chat (the members picker, `@`/`#` in the composer, a new chat), teams appear next
to agents. Picking a team adds all of its members that are not already in the chat, in the team's order.

**Why this priority**: The main time saver the person asked for: no more adding the same agents one by one.

**Independent Test**: In a new chat, pick team "Frontend" in the members picker; A and C become members. In a chat that
already has C, picking the team adds only A.

**Acceptance Scenarios**:

1. **Given** an empty new chat, **When** the person picks team "Frontend", **Then** A and C join the chat, and the first
   one becomes the leader if the chat had no leader.
2. **Given** a chat that already has C, **When** the person picks the team, **Then** only A joins; C is not duplicated.
3. **Given** a team with an archived agent, **When** the team is added, **Then** the archived agent is skipped and the
   others join.

---

### User Story 3 - Call a team by its handle (Priority: P2)

The person writes `@frontend` in a message and the team is called, as `@handle` calls one agent today.

**Why this priority**: Natural next step once teams exist, but adding the team to the chat (Story 2) already covers
most uses.

**Independent Test**: In team "Frontend" (A = "Designer", C = "Tester"), send "@frontend write tests for the header";
C answers and the chat shows the team routed to C.

**Acceptance Scenarios**:

1. **Given** team "Frontend" (A = designer, C = tester), **When** the person sends "@frontend write tests for the
   header", **Then** the team's members who were not in the chat join on send (as when the team is added), C answers, and
   the chat shows "Frontend → C".
2. **Given** a message no member clearly fits ("@frontend hi"), **When** it is sent, **Then** A (the first member)
   answers.
3. **Given** routing is unavailable, **When** the team is called, **Then** A answers and nothing is lost.
4. **Given** an agent hands off with "@frontend", **When** its reply ends, **Then** the team is called the same way,
   within the existing hand-off depth limit.
5. **Given** "@frontend" inside a code span or glued to an e-mail, **When** the message is sent, **Then** nobody is
   called (same rule as agent mentions).

---

### User Story 4 - Put an agent in a team when creating it (Priority: P2)

When creating (or editing) an agent, the person can choose one or more teams it belongs to. From a team, "New agent"
creates an agent already in that team.

**Why this priority**: Saves a step, but the person can always add the agent to the team afterwards.

**Independent Test**: Create agent D choosing team "Frontend"; the team now shows A, C, D.

**Acceptance Scenarios**:

1. **Given** the new-agent form, **When** the person picks team "Frontend" and saves, **Then** D is the team's last
   member.
2. **Given** team "Frontend" opened, **When** the person chooses "New agent" there, **Then** the form opens with that
   team already chosen.

---

### Edge Cases

- A team with no members: allowed to exist, but adding or calling it does nothing and says so.
- An agent in several teams: allowed; adding two teams that share it adds it once.
- An agent that is deleted or archived: it leaves its teams' active list; archived ones return if restored.
- A project team mixing in global agents: allowed (global agents are visible in every project); a global team holds
  global agents only.
- A team handle that matches an agent's handle: refused at save (FR-004), so `@x` is never ambiguous.
- A team called at the hand-off depth limit: only logged, as for agents today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The person MUST be able to create, rename, re-order, change members of, and delete a team.
- **FR-002**: A team MUST have a name, a handle, an ordered list of member agents, and a reach (one project, or global)
  following the same reach rule agents have.
- **FR-003**: An agent MAY belong to any number of teams; deleting a team MUST NOT change or delete any agent.
- **FR-004**: Handles of teams and agents MUST be unique together within what a chat can see, checked on the server.
- **FR-005**: Every place that adds agents to a chat MUST also offer teams; adding a team MUST add its active members
  not yet in the chat, in team order, without duplicates.
- **FR-006**: Adding a team to a chat MUST add its members, not a link to the team: later team changes do not change
  that chat's members.
- **FR-007**: The agent create/edit form MUST let the person choose teams; a team's page MUST offer "New agent" with
  the team pre-chosen.
- **FR-008**: `@team-handle` MUST follow the same mention rule as agents (code skipped, e-mails ignored) in the
  person's messages and in agent hand-offs.
- **FR-009**: Calling a team by `@handle` MUST route the message: one member answers, chosen as the best fit for what
  the message asks, from each member's name, role and description. When no member clearly fits, the team's first
  member answers. The chosen member may still hand off to teammates as agents do today.
- **FR-012**: The routing choice MUST be visible in the chat (which member was picked for the team) and MUST cost
  little next to a reply: it never runs a full agent turn of its own.
- **FR-013**: If routing fails (no model available, timeout), the team's first member MUST answer instead; the call is
  never dropped.
- **FR-010**: Team changes MUST be recorded in the audit log like agent changes, and team routes MUST check the same
  authorization as agent routes.
- **FR-011**: Archived agents MUST be skipped when a team is added or called.

### Key Entities

- **Team**: name, handle, reach (project or global), ordered members (agents), created/updated times.
- **Team membership**: an agent's place in one team (team, agent, position).

## Success Criteria *(mandatory)*

- **SC-001**: Adding a team of 4 agents to a chat takes one pick instead of four.
- **SC-002**: A team made and reloaded keeps 100% of its members and their order.
- **SC-003**: Deleting a team leaves every one of its agents and their chats exactly as before.
- **SC-004**: A `@team` in a code span or e-mail calls nobody, in 100% of the existing mention test cases.
- **SC-005**: In a set of messages written for one clear member each, routing picks that member at least 9 times in 10.
- **SC-006**: A team call starts answering about as fast as calling one agent directly (routing adds at most a few
  seconds).

## Assumptions

- "Na parte de criar" covers both creating a chat (pick a team as its members) and creating an agent (choose its team);
  both are in scope (Stories 2 and 4).
- Teams are organisation only: no team-level model, prompt, budget, memory or permissions. Each agent keeps its own.
- Teams live on the Agents page (project and global), next to the agents list; no new sidebar place.
- Routing reads what each agent already has (name, role, description); no separate routing rules to write. Picking
  a team in the members picker (Story 2) adds members and routes nothing.
- Teams do not nest (a team cannot contain a team).
- Routines keep targeting agents; running a routine for a team is out of scope.
