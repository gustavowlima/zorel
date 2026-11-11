# Feature Specification: Architecture Hardening

**Feature Branch**: `feat/browser-cursor-review` | **Created**: 2026-11-10 | **Status**: Implemented

**Input**: `/speckit-specify` with no text, run right after the architecture review of 2026-11-10 ("revise minha
arquitetura onde tem fragilidade oq pode melhorar"). This spec takes the review's recommended first items:
#1 learning failures are silent, #5 outside-triggered turns can act unchecked, #3 a limited account is forgotten on
restart, #8 a deleted chat leaves its event channel behind. The other review items are out of scope (see
Assumptions).

## Baseline

| What | Today |
|---|---|
| A chat's learning (summary, memories) fails | nothing is recorded; the chat silently stops learning |
| A webhook or connector-watch routine runs with an agent at Full access | the outside text reaches a turn that can act without asking |
| Learning from a stretch that holds a webhook or watch payload, with "keep new memories at once" on | the payload counts as something the person said; its facts are saved without review |
| A saved account hits its usage limit | already kept until the reset, across restarts |
| The default login (no saved account) hits its usage limit | set aside only 10 minutes, in memory: tried again after 10 minutes or after a restart, even if the reset is hours away |
| Any other route failure (set aside 10 minutes) | forgotten on restart |
| A chat is deleted | its live event channel stays in the server's memory until it stops |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Outside text can't act without the person (Priority: P1)

A routine started by a webhook or by watching a connector carries text that nobody on the team wrote. Whatever the
agent's access level, such a turn asks before any action that would need asking at "Ask before". What it learns from
that text waits for the person's review instead of being saved on its own.

**Why this priority**: The only item in the review that lets an outsider reach a command on the person's computer.

**Independent Test**: An agent at Full access with a webhook routine. Post a payload that asks for a shell command:
the turn asks for approval (or, with the routine's default policy, declines and reports) instead of running it.
The same agent in a chat the person writes in still runs at Full access.

**Acceptance Scenarios**:

1. **Given** an agent at Full access and a webhook routine, **When** the webhook fires, **Then** every action that
   "Ask before" would ask about waits for approval or is declined per the routine's policy.
2. **Given** an agent at Full access and a connector-watch routine, **When** new items arrive, **Then** the same holds.
3. **Given** a scheduled (cron) routine with no outside payload, **When** it runs, **Then** it keeps the agent's own
   access: the person wrote its prompt.
4. **Given** a Telegram message from the paired person, **When** it arrives, **Then** it keeps the agent's own access:
   it is the person writing.
5. **Given** an agent at "Workspace" or "Ask before", **When** an outside-triggered turn runs, **Then** its access is
   never widened, only capped.
6. **Given** "keep new memories at once" is on and a chat stretch holds a webhook or watch payload, **When** the chat
   learns, or the agent asks to remember something during that turn, **Then** the facts wait for review instead of
   being saved.
7. **Given** an outside-triggered turn that hands off to another agent, **When** that agent's turn runs, **Then** it
   carries the same cap.

---

### User Story 2 - A failed learning is visible (Priority: P1)

When a chat's learning (summary and memories) or the background fact mapping fails, the failure is recorded with the
chat and the reason, so the person or a developer can find out why a chat stopped learning.

**Why this priority**: Today a broken learning step looks the same as "nothing to learn". It breaks the project rule
that errors are never silenced without being logged.

**Independent Test**: Make the learning model fail for a chat. The app's log shows one entry naming the chat, the kind
of learning (window or quiet) and the reason. The chat keeps working.

**Acceptance Scenarios**:

1. **Given** a chat whose learning call fails, **When** the chat goes idle, **Then** one log entry names the chat, the
   kind of learning and the reason, and the chat's next turn still runs.
2. **Given** a learning skipped because another one is already running for the chat, or because there is nothing new,
   **When** it ends, **Then** it is not logged as a failure.
3. **Given** the background fact mapping fails, **When** it ends, **Then** one log entry says so with the reason.
4. **Given** a failure reason that holds a credential, **When** it is logged, **Then** the credential is masked as in
   the rest of the logs.

---

### User Story 3 - A route set aside stays set aside until it is ready (Priority: P2)

A saved account at its limit is already kept aside until its reset, across restarts. The default login (a CLI
signed in outside Zorel, no saved account) is not: it is set aside only 10 minutes and only in memory, then tried
again and fails again. Other route failures (10 minutes) are also lost on restart. Both now behave like a saved
account: set aside until the reset (or the 10 minutes), across restarts.

**Why this priority**: Costs a failed attempt and some seconds each time, not data. The server does restart (it died
once during this session).

**Independent Test**: With failover set up, make the default login report a limit that resets in 2 hours. A turn
moves to the next route. 15 minutes later, and again after a restart, a turn still skips the default login. Once
the reset time passes, it is used again.

**Acceptance Scenarios**:

1. **Given** the default login reported a limit with a reset time, **When** turns run before that time, also after a
   restart, **Then** they skip it.
2. **Given** a limit with no reset time given, **When** it is set aside, **Then** the same one-hour wait as for a saved
   account applies.
3. **Given** a route set aside 10 minutes for another failure, **When** the server restarts within those minutes,
   **Then** it is still skipped until they pass.
4. **Given** the time has passed, **When** a turn runs, **Then** the route is tried again, and what was kept for it is
   cleared.

---

### User Story 4 - A deleted chat leaves nothing running behind (Priority: P3)

Deleting a chat also releases what the server kept in memory for it (its live event channel), so a server that runs
for weeks does not grow with every chat ever opened.

**Why this priority**: Small and invisible in normal local use; it matters for a long-running server.

**Independent Test**: Open and delete many chats in one server run; the number of chats the server keeps live state
for returns to the number of chats that exist.

**Acceptance Scenarios**:

1. **Given** a chat with an open window, **When** the chat is deleted, **Then** its live state is released and the
   open window gets no more events for it.
2. **Given** a chat with a turn running, **When** it is deleted, **Then** the turn stops as deletion does today and
   the live state is released after it.

---

### Edge Cases

- An outside-triggered turn that waits for approval while nobody is there: the routine's existing policy decides
  (decline and report by default, or wait); approvals still expire after 30 minutes.
- A person's own message in a chat that also gets webhook runs: the person's turns keep full access. Only the turns
  started by the outside run are capped.
- "Always allow" rules the person set earlier for the agent still apply to outside-triggered turns: the person chose
  them for that exact action.
- A learning that fails every time for a chat: one entry per attempt, no retry loop.
- Two accounts set aside with different reset times: each comes back at its own time.
- A clock change on the computer: a reset time that is now in the past frees the route at once.
- A task an outside-triggered turn starts in another agent's chat (start_task) carries the same cap as a hand-off.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A turn started by a webhook or a connector-watch routine, or handed off from one, MUST run at most at the
  "Ask before" level, whatever the agent's or chat's level.
- **FR-002**: Turns written by the person (chat, Telegram from the paired person) and scheduled routines with no outside
  payload MUST keep today's access.
- **FR-003**: The cap MUST only lower access, never raise it.
- **FR-004**: Learning from a chat stretch that holds an outside payload, and a remember request made during an
  outside-triggered turn, MUST put facts up for review even when the person chose to keep new memories at once.
- **FR-005**: A failed chat learning or fact mapping MUST be logged once per attempt, with the chat (where there is
  one), the kind of learning and the reason, credentials masked.
- **FR-006**: A learning that did not run because one was already running, or because there was nothing to learn,
  MUST NOT be logged as a failure.
- **FR-007**: A route set aside (a limit on the default login until its reset time, or another failure for 10 minutes)
  MUST stay set aside across a server restart until that time. A saved account keeps today's behaviour.
- **FR-008**: Deleting a chat MUST release the live state the server keeps for it.
- **FR-009**: None of these changes MAY change behaviour for chats with no outside-triggered turns, beyond FR-005
  logging and FR-007.

### Key Entities

- **Turn origin**: where a turn came from: the person, a scheduled routine, an outside routine (webhook, connector
  watch), or a hand-off inheriting its parent's origin.
- **Set-aside route**: an account (or provider) and the time until which it is skipped, and why.

## Success Criteria *(mandatory)*

- **SC-001**: In 100% of test runs, a webhook payload asking for a command makes no command run without approval when
  the agent is at Full access.
- **SC-002**: 100% of forced learning failures leave a log entry naming the chat and the reason; 0 entries for skipped
  or empty learnings.
- **SC-003**: Before its reset, and also after a restart, 0 turns are attempted on a route whose limit has not reset.
- **SC-004**: After opening and deleting 100 chats in one run, the server keeps live state for no deleted chat.
- **SC-005**: Every existing test still passes; the person's own chats behave as before.

## Assumptions

- Telegram counts as the person: pairing already proves who writes.
- The cap is "Ask before" because it already exists and the routine approval policy already handles "nobody is
  there".
- Spec 004 (instruction-like text flagged in tool results) stays as is. This spec adds a limit on what such a turn may
  do, not another detector.
- Logs go where the app's logs already go, with the existing masking. No new screen.
- Out of scope, from the same review:
  - #2, splitting the runtime file: a refactor with no behaviour change, for its own pull request;
  - #4, a supervisor for the server outside the desktop app: deployment documentation;
  - #6, warning on untested CLI versions;
  - #7, routing cost;
  - #9, how a human team shares one Zorel: a product decision.
