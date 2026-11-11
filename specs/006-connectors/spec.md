# Feature Specification: Connectors Beyond Code

**Feature Branch**: `feat/memory-efficiency` | **Created**: 2026-11-08 | **Status**: Implemented

**Input**: item 1 of the platform list (2026-11-08): connector store with OAuth, for a general agent
platform, not only code.

## Baseline

The store (Settings › Connectors, `apps/web/src/features/mcp.tsx`) and OAuth for MCP (`oauth.ts`:
discovery, dynamic client registration, PKCE, refresh, tokens in the keychain) already exist, with 11
connectors, nearly all for software work (GitHub, Linear, Sentry, Vercel, Supabase, Stripe…).

## User Story 1 - Connect everyday work services in one click (P1)

**Independent Test**: each new card's URL answers an MCP `initialize` with 401 and OAuth metadata whose
authorization server advertises dynamic client registration (what `oauth.ts` needs), checked on
2026-11-08; a full sign-in is done by the person (it creates an app registration on their account).

## Requirements

- **FR-001**: Add hosted MCP connectors for work beyond code whose OAuth supports dynamic client
  registration; leave out those that don't (they would fail at sign-in).
- **FR-002**: Use the streamable HTTP endpoint (`/mcp`), the transport Zorel's client speaks.

## Result (2026-11-08)

Added 12: Todoist, ClickUp, monday.com, Airtable, Intercom, Canva, Gamma, Webflow, Wix, PayPal, Square
(OAuth, registration advertised) and Hugging Face (no sign-in). Probed and left out: Asana, HubSpot,
Box, Slack (no dynamic registration). Not verified here: a complete sign-in for each (it registers a
client on the person's account); the first person to connect one confirms it.
