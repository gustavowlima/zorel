# Feature Specification: Useful Routines

**Feature Branch**: `feat/browser-cursor-review` | **Created**: 2026-11-10 | **Status**: Implemented

**Input**: "Useful routines (foundation for a personal assistant)". The person's direction (2026-11-10) is to grow
Zorel toward an always-on personal and team assistant, with calendar and e-mail later. Routines are its foundation.

The feature, in short:
- every run ends with an outcome and tells the person only when it matters;
- every run reports only what changed since the last one;
- triggers are generic events;
- delivery is set apart from the routine;
- the person has a time profile (the day's start, quiet hours);
- outside runs queue instead of being dropped;
- a cheap check runs before a watched event wakes an agent;
- a Today page holds the morning brief;
- the Routines page gets a week calendar.

Designs: https://claude.ai/artifact/9YF5TKK1BBKX28mPtNZxEg (Routines week, Routine detail, Today).

## Baseline (read in the code, 2026-11-10)

| What | Today |
|---|---|
| Triggers | Cron, "Run now", the routine's webhook, a watched connector polled every 5 min. A run missed while asleep runs once. |
| A webhook arrives while the routine's chat is busy | The run is skipped and the event is lost. A watched connector's items come back on the next poll. |
| A run finishes | The desktop notification fires whenever a chat finishes while the person looks elsewhere, so every routine run pings, even one that found nothing. |
| Telegram | Replies only to what the person sends from Telegram. It doesn't deliver routine results. |
| A run and the previous one | The routine's chat holds the history, but nothing asks the run to compare. It repeats what is still true. |
| Quiet hours, the day's start | None. |
| A place to read what routines found | Each routine's chat, one by one. |
| Routines page | A list. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A run tells me only when it matters (Priority: P1)

Every run ends in one of three outcomes:
- **nothing new**: it found nothing worth the person's time;
- **something new**: worth reading, not urgent;
- **needs you**: the person must answer or decide.

Only "needs you" pings at once. "Something new" waits for the brief, or pings, as the routine says. "Nothing new"
never pings and shows as a quiet mark in the history.

**Why this priority**: Noise is why people turn routines off. This is the one change every other story builds on.

**Independent Test**: Three routines whose agents end with each outcome. After they run, exactly one notification
fired, the one that needs the person. All three show their outcome in their history.

**Acceptance Scenarios**:

1. **Given** a run that ends "nothing new", **When** it finishes, **Then** no notification fires on any channel, and
   its history shows a quiet entry.
2. **Given** a run that ends "needs you" (it asked a question, waits for approval, or says so), **When** that
   happens, **Then** the person is told at once on the routine's channels, quiet hours aside (Story 4).
3. **Given** a run that ends "something new", **When** it finishes, **Then** it is told per the routine's "tell me"
   setting (every time, or only in the morning brief).
4. **Given** a run whose outcome can't be read (no marker, or it failed), **When** it finishes, **Then** it counts as
   "something new". A failure counts as "needs you". Nothing is silently dropped.
5. **Given** the person sends a message in a routine's chat, **When** the agent answers, **Then** that reply follows
   the usual chat notifications. Outcomes apply to routine runs only.
6. **Given** a routine with past runs, **When** its page opens, **Then** its history lists them, newest first, with
   when, trigger, outcome, summary, cost and delivery. Opening one shows the full reply in the routine's chat.

---

### User Story 2 - A run reports only what changed (Priority: P1)

Each run is given what the previous run reported and is asked to say only what changed. A run with no change ends
"nothing new" (Story 1).

**Why this priority**: Repeating yesterday's report is the second reason routines get ignored. It also keeps runs
short, so cheaper.

**Independent Test**: A routine runs twice on the same unchanged facts. The second run ends "nothing new". After one
fact changes, the third run reports only that fact.

**Acceptance Scenarios**:

1. **Given** a routine with an earlier run, **When** it runs again, **Then** the agent is given that run's report
   and the time it ran.
2. **Given** a first run ever, **When** it runs, **Then** it reports in full.
3. **Given** the previous run failed or was stopped, **When** the next one runs, **Then** it compares with the last
   run that finished.

---

### User Story 3 - Outside events wait in line, and a cheap check comes first (Priority: P1)

A webhook or a connector event that arrives while the routine is still running waits for it instead of being
dropped. For watched connectors, a cheap check reads the new items first and starts the agent only when there is
something to act on.

**Why this priority**: Losing events is a correctness bug (review item 1(b) of spec 011). The cheap check is where
most of the cost of event routines goes away.

**Independent Test**:
- Three webhooks within one run: three runs happen, one after another, in arrival order.
- A watched connector reports an item the routine's instructions say to ignore: no agent turn starts, and the
  history shows "nothing new (checked)".

**Acceptance Scenarios**:

1. **Given** a routine run in progress, **When** a webhook for it arrives, **Then** it is queued and runs after,
   with its own payload.
2. **Given** more than 20 events waiting for one routine, **When** another arrives, **Then** the oldest waiting
   ones are kept and the newest is refused with a clear reason (the webhook caller is told). The history notes the
   overflow.
3. **Given** a watched connector with "look first" on, **When** new items arrive, **Then** a small model decides
   from the routine's instructions and the items whether to start the agent. A "no" ends the run as "nothing new",
   recorded with what it looked at.
4. **Given** the cheap check fails (no model, timeout), **When** it happens, **Then** the agent starts as it would
   without the check. An event is never lost to the check.
5. **Given** an outside run (spec 011), **When** it is queued, **Then** it keeps the outside limits: it asks before
   acting, and facts go to review.

---

### User Story 4 - My time: when my day starts, and quiet hours (Priority: P2)

The person has a time profile:
- their time zone;
- when their day usually starts, learned from their first activity of the day and editable;
- quiet hours.

A routine can run "when my day starts". During quiet hours nothing pings. What would have pinged waits for the
morning brief, and a "needs you" waits too, unless the routine is marked urgent.

**Why this priority**: It makes the assistant feel personal and keeps the night quiet. It comes after the outcome
work (P1) that it relies on.

**Independent Test**:
- Set quiet hours 21:00–07:00. A run at 23:00 ends "something new": no ping, and the item is in the next morning
  brief.
- A "when my day starts" routine runs right after the person's first activity of the day, once that day.

**Acceptance Scenarios**:

1. **Given** quiet hours, **When** a run that would ping ends inside them, **Then** nothing pings, and the item goes
   into the next brief.
2. **Given** a routine marked urgent, **When** it ends "needs you" in quiet hours, **Then** it pings anyway.
3. **Given** a "when my day starts" routine, **When** the person is first active that day (opens the app, sends a
   message, or uses Telegram), **Then** it runs once.
4. **Given** the person isn't active by a cut-off (their usual start plus 3 hours), **When** that time passes,
   **Then** the routine runs anyway, so the brief is ready when they come.
5. **Given** no profile set yet, **When** the app starts, **Then** the time zone comes from the computer, there are
   no quiet hours, and the day's start defaults to 09:00 until it is learned.
6. **Given** scheduled (cron) routines, **When** they run in quiet hours, **Then** they still run. Only their pings
   wait.

---

### User Story 5 - The morning brief on a Today page (Priority: P2)

A **Today** page gathers, since the last brief:
- what needs the person;
- what routines found ("something new" runs, each in one line, with a link to the run);
- how many runs found nothing.

It is assembled without a model call, from the runs' own reports. It is the place where held pings land.

**Why this priority**: It turns many quiet runs into one useful read. It depends on Stories 1 and 4.

**Independent Test**: After a night of five runs (one "needs you", two "something new", two "nothing new"), Today
shows one item under Needs you, two under From your routines, and "2 more runs found nothing new", folded.

**Acceptance Scenarios**:

1. **Given** runs since the last brief, **When** the person opens Today, **Then** the page shows the three groups,
   newest first in each.
2. **Given** an item opened or answered, **When** Today is shown again, **Then** that item is gone from Needs you and
   marked read elsewhere.
3. **Given** the brief is also delivered to a channel (Telegram, a page), **When** the day starts, **Then** that
   channel gets a short text version: the counts plus the "needs you" and "something new" lines.
4. **Given** nothing happened since the last brief, **When** Today opens, **Then** it says so in one line.

---

### User Story 6 - Where a routine's result lands (Priority: P2)

A routine says where its result goes, apart from what it does. It can go to one or more of:
- the desktop or browser notification;
- Telegram (when paired);
- a knowledge page, which it updates instead of piling up messages;
- the morning brief only.

**Why this priority**: The same result is useful in different places for different people. Splitting delivery from
the routine also lets later channels (push, Slack) plug in without touching routines.

**Independent Test**: A routine set to Telegram and a page ends "something new". The Telegram chat gets its text,
the page shows the new report with an earlier version kept, and no desktop notification fires.

**Acceptance Scenarios**:

1. **Given** Telegram chosen and paired, **When** a run should tell, **Then** the paired chat gets the result's text,
   split if long, with a link back.
2. **Given** a page chosen, **When** a run ends "something new", **Then** the page's body is replaced by the new
   report, and the previous body is kept as a version.
3. **Given** Telegram chosen but not paired, **When** a run should tell, **Then** the notification is used instead,
   and the routine shows that Telegram isn't connected.
4. **Given** a routine created before this feature, **When** it runs, **Then** it uses the notification channel and
   "tell me when there is something", the new defaults.

---

### User Story 7 - The week as a calendar (Priority: P3)

The Routines page gains a week view, next to the list:
- each run at its time, colored by outcome;
- the next scheduled runs, dashed;
- the day's start;
- quiet hours.

A run opens its routine. The side shows what needs the person and the week's counts: runs, told, stopped at the
cheap check, cost.

**Why this priority**: It is a view of data the other stories make. It is useful, but nothing depends on it.

**Independent Test**: With last week's runs, the week view shows each run on its day and hour with the right outcome
color, and the counts add up to the runs listed.

**Acceptance Scenarios**:

1. **Given** runs this week, **When** the week view opens, **Then** each run shows at its start time, with its
   outcome and its agent.
2. **Given** scheduled and "my day starts" routines, **When** the coming days are shown, **Then** their next runs
   show as planned.
3. **Given** a phone-width window, **When** the week view opens, **Then** the grid scrolls sideways inside its box
   and the page doesn't.

---

### Edge Cases

- **Outcome marker:** the agent's reply carries it in a form the person doesn't see as clutter. When it is missing,
  the outcome is "something new" (Story 1, scenario 4).
- **Run ends while waiting:** a run that asks for approval is "needs you" from the moment it waits, not when it ends.
- **Clock and zone changes:** times follow the profile's zone. A change of zone moves "my day starts" and quiet
  hours with it.
- **Paused agents:** a held ping, or the brief, while everything is paused still shows. Runs don't start (as today).
- **Deleted routine:** its waiting events go with it. Its past runs stay in the brief until read.
- **Event queue across a restart:** waiting events survive a restart.
- **Cheap check spending:** it counts toward the agent's monthly limit like any turn.
- **Page as destination:** the page belongs to the routine's project (or is global) and follows the existing page
  rules (versions, undo).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every routine run MUST end with one outcome: nothing new, something new, or needs you.
  - A run that waits for approval or asks a question is "needs you".
  - A failed run is "needs you".
  - An unreadable outcome is "something new".
- **FR-002**: Only outcomes the routine's "tell me" setting covers MAY notify. "Nothing new" MUST never notify. Routine
  runs MUST NOT trigger the generic "chat finished" notification.
- **FR-003**: Each run MUST be given the previous finished run's report and time, and be asked to report only what
  changed.
- **FR-004**: Outside events (webhook, connector) arriving while the routine runs MUST queue and run in order:
  - at most 20 waiting per routine;
  - the overflow is refused and noted;
  - the queue survives a restart.
- **FR-005**: A watched-connector routine MAY "look first". A small model then decides whether to start the agent,
  and a failure of that check MUST fall back to starting the agent.
- **FR-006**: The person MUST have a time profile: time zone, usual day start (learned from the first activity of
  the day, editable), and quiet hours.
- **FR-007**: A routine MAY run "when my day starts": once per day, at the first activity or at the cut-off (usual
  start plus 3 h), whichever comes first.
- **FR-008**: During quiet hours, pings MUST be held for the brief, except "needs you" from a routine marked urgent.
- **FR-009**: A Today page MUST show, since the last brief, the "needs you" items, the "something new" runs (one line
  each, linking to the run) and the count of "nothing new" runs. It MUST be assembled without a model call.
- **FR-010**: A routine MUST have delivery settings separate from its task:
  - channels: notification, Telegram, a page, brief only;
  - when to tell: every run, when there is something, or only in the brief;
  - urgent: yes or no.
- **FR-011**: Delivering to a page MUST update that page, keeping the previous body as a version.
- **FR-012**: Delivering to Telegram MUST use the paired chat. When it isn't paired, the notification is used
  instead, and the routine says why.
- **FR-013**: The Routines page MUST offer a week view with runs by outcome, planned runs, the day's start, quiet
  hours, and the week's counts.
- **FR-014**: Existing routines MUST keep running unchanged in what they do. Their delivery defaults to the
  notification with "when there is something".
- **FR-015**: Outside runs MUST keep spec 011's limits, queued or not.
- **FR-017**: Each routine MUST show its run history, newest first. Each entry shows:
  - when it ran;
  - what triggered it;
  - its outcome;
  - its one-line summary;
  - its cost;
  - whether it was told, held or refused;
  - a link to the full reply.

  The history pages back in steps of 50. Runs are kept for 90 days, with at least the last 50 per routine kept
  whatever their age, and the person can clear a routine's history.
- **FR-016**: The triggers MUST share one event shape (where it came from, what it carries), so calendar and e-mail
  triggers can be added later without changing how runs, outcomes and delivery work.

### Key Entities

- **Run**: one execution of a routine. Fields: when it started and ended, the trigger, the outcome, its short
  report (the line the brief shows), its cost, and a link to the reply.
- **Trigger event**: what starts a run. Fields: its source (time, day start, webhook, connector, and later calendar
  or e-mail), what it carries, and when it arrived. It is queued while the routine is busy.
- **Delivery settings** (per routine): channels, when to tell, urgent.
- **Time profile** (per person): time zone, usual day start (learned and edited), quiet hours.
- **Brief**: what happened since the previous one, built from the runs.

## Success Criteria *(mandatory)*

- **SC-001**: Across a week of the default catalogue, runs that end "nothing new" produce 0 notifications.
- **SC-002**: Of 10 webhooks sent while their routine is busy, 10 runs happen, in arrival order.
- **SC-003**: A routine run twice on unchanged facts ends "nothing new" the second time in at least 9 of 10 trials.
- **SC-004**: On a watched connector where most new items need no action, at least 70% of events end at the cheap
  check, without an agent turn.
- **SC-005**: During quiet hours, 0 pings happen except urgent "needs you".
- **SC-006**: The Today page shows a night's results within one screen's scroll for up to 20 runs, with "nothing new"
  runs folded into one line.
- **SC-007**: Every existing routine keeps working after the update, with no action from the person.

## Assumptions

- Today is a sidebar place, above Needs you, as in the designs. Needs you stays as it is; Today links to it.
- The outcome comes from the agent itself, in its reply, following one short instruction that routine runs get. No
  extra model call is used to judge it.
- "First activity of the day" means opening the app, sending a message, or a Telegram message from the paired
  person. A routine run is not activity.
- The cheap check uses the provider's small model ("cheap model"), as routing and learning already do.
- The calendar, e-mail, push, Slack and mobile channels are out of scope. FR-016 keeps the door open for them.
- Also out of scope, for later specs:
  - feedback memory per routine ("Useful / Change something");
  - suggesting a routine from repeated requests;
  - the agenda section on Today;
  - "you said you would" reminders;
  - a retry for failed runs.

  All of them appear in the designs and would build on this feature.
- Single person, as today. The team-sharing decision (review item #9) stays open.
- Optional modules (the person's idea, 2026-11-10), such as meeting transcripts, are later. They would plug in as
  event sources through FR-016 ("a meeting ended, here is its transcript"), with no change to runs, outcomes or
  delivery.
