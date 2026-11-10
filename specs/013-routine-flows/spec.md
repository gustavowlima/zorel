# Feature Specification: Routine Flows

**Feature Branch**: `feat/browser-cursor-review` | **Created**: 2026-11-10 | **Status**: Implemented (2026-11-10; see tasks.md As built)

**Input**: "Routine flows (phases A and B)". A routine becomes a trigger plus a graph of steps:
- the step kinds are a connector tool, an agent, a cheap check, a condition, "Ask me" and an end;
- the person edits it on a canvas, with a list view of the same graph;
- there are more kinds of trigger, each with a Test now;
- the result can be sent to a connector;
- runs are kept step by step and resume safely.

Designs: https://claude.ai/artifact/9YF5TKK1BBKX28mPtNZxEg (boards Steps, ToolStep, RunTrace, ToolPicker, Trigger,
Deliver and Flow). The connectors named in the designs (GitHub, ClickUp, Slack, Gmail, Linear) are examples only:
nothing here is specific to any connector.

## Baseline (2026-11-10, after spec 012)

| What | Today |
|---|---|
| What a routine does | One prompt to one agent; the agent decides everything inside its turn |
| Triggers | Cron, when my day starts, webhook, a watched connector (a read tool, every 5 min), Run now. No "once", no date, no monthly, no interval choice, no Test now |
| Using a connector tool deterministically | Not possible: only the agent calls tools, in its own way |
| Tool arguments (watch) | Raw JSON typed by hand |
| Where the result goes | Notification, Telegram, a page, the morning brief. Not a connector |
| A run's record | One row (outcome, summary, report); no per-step trace |
| A run interrupted by a restart | Marked "needs you"; nothing resumes |
| Editing a routine while it runs | Not versioned: the run reads the routine as it is now |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build a routine as steps (Priority: P1)

The person opens a routine and sees its trigger and its steps as a flow on a canvas. They add a step where they want
it (on a connection, or at the end), pick its kind, fill it in a side panel, connect steps, and save. A List view shows
the same flow as an ordered list, and both views edit the same routine.

**Why this priority**: Every other story is a kind of step or a way to run them. Without the editor there is nothing.

**Independent Test**: Create a routine with a trigger and an agent step, then add a second agent step after it on the
canvas and save. Reopen it and switch to List: the two steps are there, in order. Reorder them in List; the canvas shows
the new order.

**Acceptance Scenarios**:

1. **Given** a new routine, **When** the person adds a step on the canvas, **Then** it appears where they put it,
   joined to the step before, and its panel opens.
2. **Given** a connection that the steps can't make (a step whose output the next one can't take), **When** the person
   tries it, **Then** it is refused, and they are told why in one line.
3. **Given** a flow with a step no path reaches, or a required field left empty, **When** the person saves, **Then** the
   save is refused, naming the step and the field.
4. **Given** a saved routine, **When** it is edited and saved again, **Then** it gets a new version number. The old
   version is kept for the runs that used it.
5. **Given** a phone-width window or keyboard-only use, **When** the routine opens, **Then** the List view is usable
   for every action the canvas offers: add, edit, reorder, remove.
6. **Given** a routine made before this feature, **When** it opens, **Then** it shows as its trigger, one agent step
   with its prompt, and its delivery, and it runs exactly as before.

---

### User Story 2 - Use any connector's tool as a step (Priority: P1)

The person adds a "connector tool" step and picks a tool from any connected connector. The picker groups tools by
connector, separates reads from writes, and says why a tool can't be used right now: the sign-in expired, the agent
can't write there, or the tool is turned off. Each reason comes with the action that fixes it.

The step's form is built from the tool's own description of its inputs: the fields, their types, what is required,
and the allowed choices. A field can take something an earlier step gave. Test now runs the step alone and shows what
it would hand on.

**Why this priority**: Deterministic tool steps are the core gain over today's single prompt. They work the same for
every connector.

**Independent Test**: With any connector that has a read tool, add it as a step, fill its form, and press Test now.
The result shows, and the next step's panel offers that result as a value.

**Acceptance Scenarios**:

1. **Given** connectors are connected, **When** the person opens the picker, **Then** the tools show grouped by
   connector, searchable, and filterable by reads and writes.
2. **Given** a tool the routine's agent may not use (no access, write not allowed, tool off, sign-in expired), **When**
   it is shown, **Then** it is disabled, with the reason and one action that fixes it.
3. **Given** a tool whose inputs declare text, a number with limits, a choice, yes/no and a list, **When** its step
   opens, **Then** each gets a matching control. Required fields are marked. A value out of limits says what is
   allowed.
4. **Given** inputs the form can't draw (deep nesting), **When** the step opens, **Then** those inputs are edited as
   structured text and checked against the same description.
5. **Given** a field that takes an id of something the connector lists (a channel, a project), **When** the connector
   has a read tool that lists them, **Then** the person picks by name and the id is kept. Without such a tool, they
   type the id.
6. **Given** a write tool, **When** Test now runs, **Then** nothing is written. The test shows what would be sent.
7. **Given** a tool step in a run, **When** it runs, **Then** it uses the same access, approvals and limits as when
   that agent uses the tool in a chat. A write waits for approval unless it was allowed for good.

---

### User Story 3 - Runs kept step by step, resumable, never writing twice (Priority: P1)

Every run keeps, for each step, what it received, what it gave, how long it took, whether it was retried, and how it
ended. A Run view shows this as a timeline. A run stopped by a restart resumes from the step it was on. A step that
may have written is never repeated. A run always uses the routine version it started with.

**Why this priority**: Without it, steps with side effects are unsafe. It is the reliability the person asked for.

**Independent Test**:
- Run a three-step routine and open the run: three steps with their inputs and outputs.
- Stop the server during the second step and start it again: the run goes on from the second step.
- If the second step was a write that may have gone out, it asks the person instead of repeating.

**Acceptance Scenarios**:

1. **Given** a finished run, **When** the person opens it, **Then** each step shows its status, duration, retries, and
   a preview of its input and output, with the full data one click away.
2. **Given** a run interrupted on a read step, **When** the server starts again, **Then** that step runs again and the
   run continues.
3. **Given** a run interrupted on a write step whose call may have reached the connector, **When** the server starts
   again, **Then** the step is not repeated. The run waits for the person ("it may have gone out: send again, skip, or
   stop").
4. **Given** a step that failed because its call never reached the connector (no connection, refused before sending),
   **When** it has retries left, **Then** it is retried. A failure after the call may have run is not retried.
5. **Given** a run on version 3, **When** the person saves version 4 meanwhile, **Then** the run finishes on version 3,
   and the Run view says which version it used.
6. **Given** outputs that contain credentials, **When** they are kept with the run, **Then** they are masked as in the
   rest of the app.

---

### User Story 4 - More ways to start a routine, each testable (Priority: P2)

The trigger offers:
- at a time: weekly, once, on a date, or a day of every month;
- when my day starts;
- when something new arrives in a connector;
- when a message arrives in a connector's channel;
- when a script calls;
- only by hand.

For connector triggers, the person picks the connector and what to watch (by name where the connector can list it),
how often to check, and an optional "only when…" filter. Test now shows what the trigger would find right now, and
runs nothing.

**Why this priority**: It widens what routines react to. It builds on spec 012's triggers and isn't required for steps
to work.

**Independent Test**:
- A "once" trigger set five minutes ahead runs once, then turns itself off.
- A "message arrives" trigger on a test channel, after Test now, lists the new messages and which ones would start a
  run.

**Acceptance Scenarios**:

1. **Given** "once" at a time, **When** that time comes, **Then** it runs once and the routine shows as done, not
   scheduled.
2. **Given** "monthly on day 31", **When** a month has fewer days, **Then** it runs on that month's last day.
3. **Given** a message trigger on two channels, **When** new messages arrive, **Then** each new message starts one run,
   one at a time. Messages that existed when the routine was turned on don't start runs.
4. **Given** a check interval of 1, 5, 15 or 60 minutes, **When** it is set, **Then** the connector is checked at that
   pace, never faster than once a minute.
5. **Given** Test now on a connector trigger, **When** it runs, **Then** it shows the items found and which ones the
   filter and the cheap check would let through. No run starts.

---

### User Story 5 - Send the result to a connector (Priority: P2)

Besides Zorel's own places, the result can go to any connector tool that posts. The person picks the connector and
the tool; the field that takes the text is found from the tool's inputs, and the other fields (such as a channel) are
picked by name. When the run started from a message, the reply can go into that message's thread. A preview and a
dry test show what would be posted.

**Why this priority**: It closes the loop (an event comes in, the answer goes back where it came from). It reuses
Story 2's tool handling.

**Independent Test**: A routine with a connector destination sends its result to a test channel after approval. A run
that ends "nothing new" posts nothing.

**Acceptance Scenarios**:

1. **Given** a write tool with one text field, **When** it is picked as a destination, **Then** that field is filled
   with the routine's result and shown as such.
2. **Given** a tool with several text fields, **When** it is picked, **Then** the person chooses which one takes the
   result.
3. **Given** a run that ends "nothing new", **When** delivery happens, **Then** nothing is posted to the connector.
4. **Given** "post without asking" off (the default), **When** a run delivers, **Then** the post waits for approval in
   Needs you.
5. **Given** a post that failed after it may have gone out, **When** the run ends, **Then** it isn't sent again, and the
   person is told.

---

### User Story 6 - Branch, ask, and end quietly (Priority: P2)

A condition step sends the flow one way or the other (yes / no), judged from what earlier steps gave, by a simple rule
or by the cheap model. An "Ask me" step waits for the person's OK, in Needs you and on Telegram, with a time limit. An
end step closes a branch. A run that ends on a quiet branch counts as "nothing new".

**Why this priority**: These are what make a flow more than a list of calls. Linear flows work without them (Stories
1–3).

**Independent Test**: A flow "message → is it for Atlas? → yes: Atlas answers; no: end". Messages that match reach
Atlas, and the others end quietly with no notification.

**Acceptance Scenarios**:

1. **Given** a condition with a rule over an earlier step's data (for example "has at least 1 item"), **When** it
   runs, **Then** the path taken is shown in the run.
2. **Given** a condition judged by the cheap model, **When** the model can't answer, **Then** the condition's default
   branch (chosen by the person, "yes" unless set) is taken, and the run notes it.
3. **Given** an "Ask me" step, **When** the person approves, declines, or the time limit passes, **Then** the flow goes
   on, takes its "declined" path, or ends, in that order. Each is shown in the run.
4. **Given** a run that ends on an end step, **When** it finishes, **Then** its outcome is "nothing new" and it doesn't
   notify.

---

### Edge Cases

- **A connector tool changed after saving** (removed, renamed, or a new required input): the routine shows "needs
  attention" on that step, and runs stop there with the reason. They don't guess.
- **Loops:** a flow can't loop back in this phase (the editor refuses it). Repeating work is done by running the
  routine again.
- **Parallel branches:** only one path runs at a time; a condition picks one. Running branches side by side is out of
  scope.
- **Size:** at most 30 steps per routine. Outputs passed between steps and kept are cut at a stated size, with the
  full result available as a file in the run when larger.
- **Outside text:** text from a trigger (a message, a webhook body) and tool results stay "outside text" (spec 011).
  Steps after it work at "ask" and can't widen access.
- **A deleted connector:** its steps and destinations show as broken. The routine can't be turned on until they are
  fixed or removed.
- **Approvals expiring:** an "Ask me" step or a write approval left unanswered past its limit takes the safe path: it
  ends without writing, and the run says so.
- **Two runs:** a routine runs one at a time; others wait in the queue (spec 012).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A routine MUST be a trigger followed by a flow of steps of these kinds: connector tool, agent, cheap
  check, condition (two branches), "Ask me", end. There are at most 30 steps and no loops.
- **FR-002**: The person MUST be able to edit the flow on a canvas and in a list view. Both views MUST edit the same
  routine, and every action MUST be possible in the list view (phone width, keyboard only).
- **FR-003**: Each step kind MUST declare what it takes and what it gives, from a small fixed set: text, data, a
  decision. A connection between incompatible steps MUST be refused in the editor, and refused again when saving, with
  the reason.
- **FR-004**: Saving MUST check that every step is reachable from the trigger and that every required field has a value.
  A failure MUST name the step and the field.
- **FR-005**: Each save MUST create a new version. A run MUST keep and use the version it started with.
- **FR-006**: A connector tool step MUST work with any connected connector. Its form MUST be built from the tool's own
  input description (types, required fields, choices, limits), falling back to checked structured text for inputs the
  form can't draw.
- **FR-007**: A field MUST be able to take a value an earlier step gave. Fields that hold an id MUST offer picking by
  name when the same connector has a read tool that lists those items.
- **FR-008**: Test now MUST run a tool step alone and show its result. A write tool MUST be tested without writing.
- **FR-009**: The tool picker MUST group tools by connector, separate reads from writes, and show why a tool can't be
  used, with the action that fixes it.
- **FR-010**: Tool steps MUST use the same access, approvals and limits as the agent the routine runs as. No step MAY
  widen access, and outside text keeps spec 011's limits.
- **FR-011**: Each run MUST keep, per step, its input and output previews (full data retrievable), status, duration,
  retries and ending. These are shown in a Run view.
- **FR-012**: A run interrupted by a restart MUST resume at the step it was on. A step that may already have written
  MUST NOT run again without the person's choice.
- **FR-013**: A failed tool call MUST be retried (within the step's retry setting) only when it surely never reached the
  connector.
- **FR-014**: Triggers MUST include:
  - at a time (weekly, once, on a date, monthly);
  - when my day starts;
  - when something new arrives in a connector;
  - when a message arrives in a connector's channel;
  - when a script calls;
  - only by hand.

  Connector triggers MUST let the person set the check interval (1, 5, 15 or 60 min) and an optional filter.
- **FR-015**: Test now on a trigger MUST show what it would find, and what the filter and the cheap check would let
  through, without starting a run.
- **FR-016**: Delivery MUST offer sending the result to any connector write tool that takes text:
  - the text field is found from the tool's inputs, or chosen by the person when there are several;
  - the other fields are picked by name where possible;
  - replying in the triggering message's thread is offered where the tool allows it.
- **FR-017**: A delivery to a connector MUST NOT post when the run is "nothing new". It MUST ask first by default, and a
  post that may have gone out MUST NOT be sent twice.
- **FR-018**: A condition MUST decide from earlier steps' output by a simple rule or by the cheap model, with a default
  branch when the model can't answer.
- **FR-019**: An "Ask me" step MUST wait in Needs you (and on Telegram when paired) with a time limit, and its approve,
  decline and expire paths MUST each be shown in the run.
- **FR-020**: Existing routines MUST open as a trigger, one agent step and their delivery, and MUST run as before.
- **FR-021**: The flow format MUST be one shared definition, used to validate both in the editor and when saving, so the
  two can't disagree.

### Key Entities

- **Routine version**: one saved state of a routine. It holds the trigger, the steps, the connections between them
  (with branch labels) and the delivery.
- **Step**: an id, its kind, its settings (for a tool step: connector, tool, input values, and which values come from
  which earlier step), and its retry rule.
- **Connection**: from one step's output to another step's input, typed (text, data, decision). A condition's
  connections carry the branch.
- **Run step**: one step of one run: status, input and output previews (and a link to the full data), duration,
  attempts, and whether a write may have happened.
- **Destination**: a connector write tool with fixed input values and the field that takes the result.

## Success Criteria *(mandatory)*

- **SC-001**: A person can build "message arrives → condition → agent → Ask me → reply in the connector" in under 5
  minutes, without typing any structured text, on a connector with read and write tools.
- **SC-002**: 100% of incompatible connections and unreachable steps are refused before a routine can be turned on.
- **SC-003**: Across 20 forced restarts mid-run, 0 write steps run twice. Every interrupted run either resumes or asks
  the person.
- **SC-004**: A routine with up to 30 steps opens and responds to dragging with no visible lag on a typical laptop.
- **SC-005**: Test now answers within 5 seconds for a tool step or a connector trigger, with a responsive connector.
- **SC-006**: Every routine that existed before keeps running with no action from the person, and its runs look the
  same in its history.
- **SC-007**: In a usability check, a person finds why a tool is unusable and fixes it from the picker in at most two
  clicks.

## Assumptions

- **Canvas:** the editor uses React Flow, loaded only on the routine editor screen. This was decided on 2026-11-10 from
  a measured comparison (2000 nodes: 65 ms to open, against 5.3 s and 12.5 s for the alternatives). The list view is
  the accessible and phone path.
- **One kind of tool step for every connector:** no connector-specific step kinds (unlike OpenBot's fixed nodes).
- **Conditions:** "simple rule" means a small fixed set of checks on an earlier step's output (has items, is empty,
  contains text, a field equals a value). There is no expression language.
- **Retries:** one try by default and up to 3, 30 s apart. Reads may retry on any failure that surely didn't run;
  writes only when the call never reached the connector.
- **Limits:** "Ask me" uses the existing approval time limit (30 min) unless changed per step.
- **Out of scope** for this phase: loops, parallel branches, routines that call other routines, a step that runs code,
  sharing flows between people (review item #9 stays open), and a marketplace of flow templates.
- **Builds on:** spec 012 (runs, outcomes, delivery, queue, time profile) and spec 011 (outside text).
