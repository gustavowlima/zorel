# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Developers and small teams (2–5 people)** who work with AI agents on code projects.

**Situation:** each person has their own subscriptions (Claude, ChatGPT) and API keys and coordinates several agents across several projects. Today each CLI lives in an isolated session, and the context has to be explained again when switching tool, model or teammate.

**Job to be done:** take a code task from request to result with agents that know the project, pick up where it left off (any person, any model) and keep control over what the agents do.

**Open decision:** how the team shares Zorel before the hosted mode (phase 8 of the architecture). Options: a Zorel server reached over the team's network, or bringing part of phase 8 forward (login and simple roles). None of this decision is implemented.

## Product Purpose

Zorel is a workspace for AI agents organized into **projects**, with a **team of agents** per project and standalone **chats**. It runs the harnesses the person already uses (Claude Code, Codex, OpenCode and other CLIs via ACP) and keeps the context and knowledge of the work.

**Success:** open a new chat, or switch models, and the agent already knows what was decided, what failed and how things are done in the project, without anyone explaining it again. Everything an agent does that changes something stays visible and goes through the chosen approval level.

## Positioning

What T3 Code, a reference app and Claude Code cannot truthfully say:

1. **The context belongs to Zorel, not to the CLI session.** Switching model or provider at any time loses nothing. The context is assembled in layers by Zorel and serves as a resume point for any harness.
2. **Learns by working.** The work becomes project knowledge (decisions, pitfalls, how-tos, sessions) with versions and undo. What is about the person goes through that person's approval.
3. **A team of agents with responsibilities.** The agents delegate to each other, with clear approvals and the exchange between them visible in the chat.
4. **Uses what you already pay for.** Subscriptions through the official CLI and API keys (via OpenCode), with several accounts per provider, optional automatic switching when the limit runs out, and visible usage.

## Operating Context

- **Use:** on the desktop (Electrobun app) and in the local browser. The hosted mode comes later.
- **Routine:** open a project, talk to the lead agent or mention a teammate with `@`, approve actions, review what Zorel learned, and switch model or account according to cost and limit.
- **Surrounding tools:** git, editor, terminal and MCP servers (GitHub, Linear, Notion…), always chosen per project.

## Capabilities and Constraints

- **Projects:** brief, folder on disk, default agent, agents, chats and knowledge.
- **Standalone chats and channels** with several agents.
- **Engines:** subscription → the owner's harness (Claude Agent SDK, Codex App Server, ACP); API key → OpenCode via ACP.
- **Approvals at three levels per agent** (Workspace, Ask first, Full access) and a "Needs you" screen.
- **Tools:** MCP per project, with a read / approval / automatic policy.
- **Interface in English only for now**, with i18n from the start. User content is never translated.
- **Lightweight:** one process, one database file, no required external service.
- **Provider terms:** Zorel never reads or stores the CLIs' login. Using a subscription through a third-party app is a gray area, and the user is warned about it.
- **Technical details and phases:** `docs/ARCHITECTURE.md` at the repository root.

## Brand Commitments

- **Name: Zorel** (changed from "Zero" on 2026-11-04: "Zero" collided with other products and had no domain). Own domain: zorel.dev.
- **Open source, Apache-2.0.**
- **Tone:** direct, technical, no empty jargon.
- **Visual direction:** chosen by the user as a commitment, **inspired by a reference app** (reference only; no code or CSS copied). The details live in `DESIGN.md`.

## Evidence on Hand

- **What exists:** MVP code in `apps/`, end-to-end tests in `apps/server/src/*.test.ts`, icon in `apps/desktop/assets/icon.svg` and documentation in `docs/`.
- **What does not exist, and must not be invented:** users, testimonials, usage metrics, pricing, published performance comparisons.

## Product Principles

1. **Continuity above all.** No one should need to explain the project again: not to another model, not to another agent, not to another person.
2. **Visible control.** Every action that changes something has an owner, shows up in the chat and respects the approval level. Everything learned can be seen, undone or forgotten.
3. **Lightweight first.** Start at the useful minimum and grow only with measured evidence.
4. **Provider-neutral.** Works with the subscriptions and keys the person already has, without lock-in to any model.

## Accessibility & Inclusion

- Full keyboard navigation, visible focus and accessible labels (React Aria base).
- Respects "reduce motion".
- Adequate contrast in the dark (default) and light themes.
