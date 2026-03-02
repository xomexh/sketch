# Changelog

All notable changes to this project are documented here.

## [0.7.0] — 2026-03-02

- WhatsApp group support with mention-only activation
- Persistent typing indicator for message processing feedback
- WhatsApp LID-format JID handling for DM messages
- Team page for managing workspace members
- Self-hosting guide

## [0.6.1] — 2026-03-02

- Fix non-null assertions in team page
- Fix WhatsApp LID-format JID handling

## [0.6.0] — 2026-03-02

- Persistent typing indicator while agent is processing

## [0.5.0] — 2026-02-28

- Cross-session memory via CLAUDE.md — personal, channel, and org layers
- DB-backed admin onboarding wizard for self-hosted setup
- JWT-based persistent admin authentication
- Channels page with Slack connect dialog and WhatsApp QR pairing
- WhatsApp adapter via Baileys with DB-backed auth and pairing
- SSE-based WhatsApp QR pairing with cancel support
- Slack disconnect flow

## [0.4.0] — 2026-02-26

- Streaming assistant messages via onMessage callback
- Control plane steel thread — admin login, app shell, channels page

## [0.3.0] — 2026-02-24

- Per-thread sessions and passive thread message buffering
- Inline buffered file attachments with sender's message

## [0.2.0] — 2026-02-23

- File support — receive, native vision, and send back
- MCP tools support in canUseTool permissions
- Node.js 24 upgrade

## [0.1.0] — 2026-02-19

- Slack channel @mentions with threaded replies
- Vitest unit tests for all server modules
- Skills support in agent runner
- Thread context support and configurable history limits

## [0.0.1] — 2026-02-17

- Initial steel thread — Slack DM to agent to response
- Monorepo scaffold with pnpm, Biome, TypeScript
