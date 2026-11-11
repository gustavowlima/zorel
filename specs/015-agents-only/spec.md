# Feature Specification: Always With Agents

**Feature Branch**: `feat/browser-cursor-review` | **Created**: 2026-11-11 | **Status**: Draft

**Input**: "sobre conseguir utilizar somente com agents? ou seja tem que criar primeiro agente" (2026-11-11). The user
chose:
- a guided first step that is mandatory;
- old chats without an agent can be ignored (they are test data);
- this spec comes before the server spec (014), because a team server is simpler when everything has an owner.

Zorel becomes a place where you always talk to agents: the first run makes the first one, every chat has at least
one, and nothing answers as an anonymous "assistant".

## Baseline (2026-11-11, after release 0.6.0)

| What | Today |
|---|---|
| First run | No first-run screen. A fresh install opens on Home and a plain chat can start at once |
| A chat without an agent | Allowed: Home's "×" goes back to a plain chat, and a project with no crew starts one. The model answers as "Assistant" |
| The server | Accepts a chat with no agents and runs its turns on the chat's model with no agent (no persona, no agent memory, a shared "assistant" browser profile) |
| Removing agents | Archiving or deleting an agent leaves chats that had only it with nobody to answer, and the last agent can be removed |
| Telegram | A new Telegram chat has no agent |
| Routines, webhooks, flows, tasks | Already bound to an agent |
| The Builder | A built-in helper that creates agents. It is not a teammate (hidden from lists and pickers) |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The first run makes the first agent (Priority: P1)

Someone opens Zorel for the first time. Before anything else, a short guided step asks for their first agent:
- **name:** with a suggestion they can keep;
- **what it is for:** a few ready choices (research, writing, code, operations) or their own words, which become the
  agent's instructions;
- **which AI it uses:** the ones already connected are shown as ready; if none is, the step says how to connect one,
  in place.

When they finish, Zorel opens a new chat with that agent and the composer ready.

**Why this priority**: Without a first agent, nothing else in this spec can hold. It is also the first impression.

**Independent Test**: Start Zorel with an empty data folder. The guided step shows and nothing else is reachable.
Create the agent, and a chat with it opens. Restart Zorel: the step does not show again.

**Acceptance Scenarios**:

1. **Given** no agents of the person's own (the built-in Builder doesn't count), **When** Zorel opens, **Then** the
   guided step shows and the rest of the app is out of reach until it is done.
2. **Given** the guided step, **When** the person picks a ready choice for "what it is for", **Then** the agent gets
   instructions that match it, which they can edit later.
3. **Given** no AI connected, **When** the step reaches "which AI", **Then** it says how to connect one without
   leaving the step (sign in to a subscription or add a key), and continues once one is ready.
4. **Given** the step completed, **When** Zorel restarts, **Then** it opens normally, and the step never returns while
   any agent of the person's own exists.
5. **Given** an existing install that already has agents, **When** it updates to this version, **Then** no step shows
   and nothing changes for the person.

---

### User Story 2 - Every chat has an agent (Priority: P1)

A new chat always starts with an agent: the project's crew in a project, otherwise the agent the person used last. The
person can change who is in the chat, but never down to nobody. Replies always come from a named agent, with its
persona, memory, permissions and browser.

**Why this priority**: This is the rule itself. Memory, permissions and the browser always have an owner, and the
team server (014) can rely on it.

**Independent Test**: On Home, start a chat without picking anyone: it has the last-used agent. Try to remove the only
agent from a chat: it can't be done. Ask the server for a chat with no agents: it is refused.

**Acceptance Scenarios**:

1. **Given** Home outside a project, **When** the person sends a first message without picking anyone, **Then** the
   chat starts with the agent they used last (or their first agent), shown before they send.
2. **Given** a project with a crew, **When** a chat starts there, **Then** it starts with the crew, as today. There is
   no "×" back to a chat without agents.
3. **Given** a chat with one agent, **When** the person tries to remove it, **Then** the control is not offered, and
   the server refuses the change if asked directly.
4. **Given** any request to create a chat with no agents (the app, a channel, an API call), **When** it reaches the
   server, **Then** it is refused with a clear reason.
5. **Given** a project's settings, **When** the person edits its crew, **Then** an empty crew means "the agent you used
   last", and the settings say so. There is no "No agent" choice.

---

### User Story 3 - Agents can't all disappear (Priority: P2)

Archiving or deleting agents never leaves the person without one, and never leaves a chat with nobody to answer.

**Why this priority**: Without it, the rule from Story 2 breaks the moment an agent is removed.

**Independent Test**: With one agent, try to archive or delete it: refused, with the reason. With two agents, delete
the one that is alone in a chat, then open that chat: it asks who should continue it before the next message.

**Acceptance Scenarios**:

1. **Given** the person's last agent, **When** they try to archive or delete it, **Then** it is refused, and they're
   told to create another first.
2. **Given** a chat whose only agent was archived or deleted, **When** the person opens it, **Then** its history reads
   as before, and sending asks them to pick who continues it. The message is sent once they pick.
3. **Given** a routine whose agent was deleted, **When** its time comes, **Then** it doesn't run, and the person is
   told the routine needs an agent.

---

### User Story 4 - Channels answer as an agent (Priority: P3)

Messages that arrive from Telegram are answered by an agent the person chose in Settings › Channels (by default, the
agent they used last), never by an anonymous model.

**Why this priority**: It closes the last path that creates chats without an agent. Few people use channels yet.

**Independent Test**: Pick an agent for Telegram in Settings › Channels, then send the bot a message: the new chat has
that agent, and the reply is in its name.

**Acceptance Scenarios**:

1. **Given** Telegram paired, **When** a message starts a new chat, **Then** the chat has the chosen agent.
2. **Given** the chosen agent was archived, **When** a message arrives, **Then** the agent used last answers, and
   Settings shows that the choice needs updating.

---

### Edge Cases

- Only the Builder exists (a person who used "Build with AI" before this version but never created an agent): the
  first-run step shows. The Builder never counts as the person's agent.
- The person closes the app during the first-run step: it shows again on the next start, with what they typed kept.
- Old chats without any agent (data from before this version): they open and read as before; sending asks who
  continues them, like a chat whose agent was deleted. No migration is required (the user's existing ones are test data).
- An agent is archived while one of its turns runs: the turn finishes; the next message asks who continues.
- Two windows try to delete the last two agents at once: the server keeps at least one.
- Everything works on Windows, macOS and Linux, in the desktop app and the local web.

## Requirements *(mandatory)*

### Functional Requirements

**First run**

- **FR-001**: When the person has no agents of their own (the built-in Builder excluded), Zorel MUST show the guided
  first-agent step and nothing else.
- **FR-002**: The step MUST ask for:
  - a name, with a suggestion;
  - what the agent is for: ready choices that set matching instructions, or the person's own words;
  - which AI it uses, among those connected, with a way to connect one in place when none is.
- **FR-003**: Finishing the step MUST create the agent and open a new chat with it. What was typed MUST survive
  closing the app midway.
- **FR-004**: Installs that already have agents MUST NOT see the step.

**Every chat has an agent**

- **FR-005**: The server MUST refuse to create a chat with no agents, or to change a chat so it has none, from any
  source (app, channel, routine, API).
- **FR-006**: A new chat with nobody picked MUST start with the project's crew, or the agent the person used last, or
  their first agent, in that order. Home MUST show who it is before sending.
- **FR-007**: The app MUST NOT offer a chat without agents: no "×" back to a plain chat, no "No agent" choice.
- **FR-008**: Every reply MUST come from a named agent. The anonymous "assistant" answers only for history written
  before this version.

**Agents can't all disappear**

- **FR-009**: The server MUST refuse to archive or delete the person's last agent.
- **FR-010**: A chat left with no active agent MUST ask who continues it before the next message is sent, and keep the
  message until then.
- **FR-011**: A routine whose agent is gone MUST NOT run, and the person MUST be told.

**Channels**

- **FR-012**: Telegram chats MUST be answered by an agent chosen in Settings › Channels (default: the agent used last).

### Key Entities

- **Agent**: unchanged. "The person's agents" means teammates, never the built-in Builder.
- **Chat**: always has at least one agent. Old chats with none stay readable but can't be continued as they are.
- **First-run draft**: what the person typed in the guided step, kept until the agent exists.
- **Channel agent**: which agent answers each channel (Telegram).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new person goes from opening Zorel to their first message to their own agent in under 1 minute, when
  an AI is already connected.
- **SC-002**: Across the automated suite, no path creates a chat with no agents, and every reply saved after this
  version has an agent.
- **SC-003**: An install that already has agents updates with no new screen and no change in behavior.
- **SC-004**: Removing agents never leaves the person with zero agents, in 100% of attempts, including two at once.

## Assumptions

- The person's existing agentless chats are test data. They stay readable, and no automatic migration is done.
- "The agent used last" is the agent of the person's most recent chat outside the Builder.
- The ready choices for "what it is for" are a short list of instructions written in Zorel's voice, editable after.
  The Builder stays available for richer agents.
- The shared "assistant" browser profile on disk is left alone; new browsing is always in an agent's profile.
- Out of scope:
  - per-person agents on a team server (spec 014);
  - changing how routines pick agents (already bound);
  - removing the anonymous name from old history.
