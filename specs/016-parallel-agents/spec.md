# Feature Specification: Agents Answer Together

**Feature Branch**: `feat/agents-only-tools` | **Created**: 2026-11-11 | **Status**: Draft

**Input**: "vários agentes em paralelo no mesmo chat" (2026-11-11). When a message calls several agents, they should
work at the same time instead of one after the other.

## Baseline (2026-11-11)

| What | Today |
|---|---|
| A message to several agents | "@Ana @Rex look at this" queues one turn per agent. The chat's one worker runs them in order: Rex starts when Ana finishes |
| Hand-offs | An agent that mentions another (or calls `send_message` / `start_task`) queues the other's turn after its own. `start_task` already runs in another chat, so it is parallel today |
| The live reply | The web keeps one live turn per chat (`ChatState.live`) and one status line |
| Steering and Stop | `steering`, `running` and `holding` are keyed by chat: one running turn to steer or stop |
| Limit | Settings › General "agents at work at once" (`maxRunning`) counts chats with a worker, not agents |
| Sessions | Native sessions are already keyed by chat and agent (`chatId:agentId`) |
| Events | Text, steps and approvals already carry their turn id |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Several agents called by one message work at once (Priority: P1)

The person writes "@Ana @Rex review this PR". Ana and Rex start together. Each answer streams in its own reply, with
its own steps, status and Stop. Each sees the conversation up to the person's message, not the other's answer.

**Why this priority**: It is the feature. Today a team of three takes three times as long for a question each can
answer alone.

**Independent Test**: Mention two agents whose engines answer slowly; both replies stream before either finishes.

**Acceptance Scenarios**:

1. **Given** a chat with Ana and Rex, **When** the person mentions both, **Then** both turns start within a second of
   each other and both live replies show.
2. **Given** both are working, **When** Ana finishes first, **Then** her reply is saved and shown as finished while
   Rex keeps streaming below it.
3. **Given** both are working, **When** the person presses Stop on Rex's reply, **Then** only Rex stops; the
   composer's Stop stops both.

---

### User Story 2 - Two agents that edit the same project each work in their own copy (Priority: P1)

Two agents that may change files in the same git project would overwrite each other's edits. When a second one
starts while another writer is at work there, it works in its own git worktree of the project, on its own branch
(`zorel/<chat>-<agent>`), and keeps that copy for the rest of the chat. Its reply says so, and the person merges the
branch into the project (or discards it) from the chat. Agents that only read, or ask before every edit, work in the
project folder alongside. A folder that isn't a git repository has no worktrees: there the second writer waits.

**Why this priority**: Parallel work must not corrupt the person's files.

**Independent Test**: Call two agents with Workspace access on the same git project: both start at once, the second
in its own worktree; its edits land on its branch, not in the project folder.

**Acceptance Scenarios**:

1. **Given** Ana and Rex both have Workspace access in git project P, **When** both are called, **Then** both start;
   Rex works in `worktrees/P/<chat>-rex` on branch `zorel/<chat>-rex`.
2. **Given** Rex has an own copy in this chat, **When** Rex is called again later, **Then** it works in the same copy.
3. **Given** Rex's branch has commits or changes, **When** the person presses "Merge into the project", **Then** the
   branch is merged into the project's current branch; a conflict leaves the project as it was and says so.
4. **Given** project Q is not a git repository, **When** two writers are called, **Then** the second waits for the
   first ("Waits for Ana to finish editing").
5. **Given** Rex has "Ask first", **When** both are called, **Then** Rex works in the project folder alongside.

---

### User Story 3 - Limits (Priority: P2)

"Agents at work at once" (Settings › General) now counts agents, not chats: two agents in one chat take two places.
A new setting, "Agents at once in a chat", has no limit by default; set, a chat starts at most that many turns
together. A turn over a limit waits in line, as a chat does today.

**Acceptance Scenarios**:

1. **Given** the global limit is 2 and one chat has Ana working, **When** the person calls Rex and Bia in another
   chat, **Then** Rex starts and Bia waits until a place frees.
2. **Given** "Agents at once in a chat" is 1, **When** the person calls Ana and Rex, **Then** they run one after the
   other, as before this feature.

---

### Edge Cases

- A hand-off (an agent mentions another in its answer) stays in order: the called agent needs that answer.
- A new message while several agents work: it goes to its recipients only. A recipient that is working takes it
  mid-turn when its engine can (steer), else its turn is stopped and restarts with the message; the others go on.
- Approvals from two agents at once: each card names its agent; Pendências lists both.
- A restart mid-batch: every running turn is saved as interrupted, as today.
- A chat with one agent behaves exactly as today.
- The order of the saved replies is the order they finished.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The turns queued by one person's message for different agents MUST start together, up to the limit.
- **FR-002**: A turn queued by a hand-off MUST start after the turn that handed it over, as today.
- **FR-003**: Two turns that may write in the same folder (access Workspace or Full, same cwd) MUST NOT run in that
  folder at the same time: in a git project the later one moves to its own worktree for the chat (kept for the
  agent's next turns there); elsewhere it waits and says for whom.
- **FR-003a**: The person MUST be able to merge an agent's worktree branch into the project, or discard it, from the
  chat; a merge conflict MUST leave the project unchanged.
- **FR-004**: Each parallel turn MUST see the history up to the message that called it, not the other answers in
  progress.
- **FR-005**: Each live turn MUST have its own reply, steps, status and Stop; the composer's Stop MUST stop all of the
  chat's turns.
- **FR-006**: The sidebar MUST say who is working ("Ana and Rex working").
- **FR-007**: "Agents at work at once" MUST count running turns, not chats. "Agents at once in a chat" MUST default
  to no limit.
- **FR-008**: A chat with one agent MUST behave as today.

### Key Entities

- **Batch**: the turns queued for one person's message, one per agent. Started together.
- **Writer**: a running turn whose access lets it edit (Workspace or Full) in a folder. One per folder.
- **Agent worktree**: a chat's own copy of the project for one agent (folder + branch), kept until merged, discarded
  or the chat is deleted.

## Success Criteria *(mandatory)*

- **SC-001**: With two slow agents called together, the time to both answers is the slower one's, not the sum.
- **SC-002**: No test with two writers in the same folder ever has both running at once.
- **SC-003**: Every existing runtime test passes unchanged (one agent per chat).

## Decisions (2026-11-11, the user)

1. Writers in the same folder: separate git worktrees (the person merges).
2. A new message during a batch: only its recipients are affected.
3. Agents at once in a chat: no limit by default, a setting caps it.
