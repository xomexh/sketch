<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/sketch.png" />
    <source media="(prefers-color-scheme: light)" srcset="assets/sketch-dark.png" />
    <img alt="Sketch" src="assets/sketch-dark.png" width="120" />
  </picture>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/version-0.9.0-green?style=for-the-badge" alt="v0.9.0" />
  <img src="https://img.shields.io/badge/node-24%2B-brightgreen?style=for-the-badge" alt="Node 24+" />
  <a href="https://github.com/canvasxai/sketch/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/canvasxai/sketch/ci.yml?style=for-the-badge&label=CI" alt="CI" /></a>
  <a href="https://github.com/canvasxai/sketch/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge" alt="PRs Welcome" /></a>
  <a href="https://platform.claude.com/docs/en/agent-sdk/overview"><img src="https://img.shields.io/badge/built%20with-Claude%20Agent%20SDK-D97757?style=for-the-badge" alt="Built with Claude Agent SDK" /></a>
</p>

<p align="center">
  Org-level AI assistant — one deployment, every team member, any channel.
</p>

---

> Inspired by [OpenClaw](https://github.com/openclaw/openclaw) — the personal AI assistant. Sketch brings the same multi-channel assistant experience to teams and organizations.

## Why Sketch

Personal AI assistants are powerful but isolated. Each person manages their own context, connects their own tools, maintains their own setup. There's no shared knowledge, no shared infrastructure.

Sketch fixes this. Deploy once for your team — everyone gets a capable AI assistant through the platforms they already use.

## Features

- **Isolated workspaces** — personal files, memory, and sessions that don't leak between users
- **Shared org knowledge** — upload documents once, available to everyone's assistant
- **Multi-channel access** — Slack and WhatsApp, same assistant everywhere
- **Per-user tool auth** — each person connects their own integrations
- **Cross-session memory** — personal, channel, and org-level memory layers
- **Web-based admin UI** — onboarding wizard, channel management, team settings
- **Self-hostable** — single Node.js process, SQLite by default, no external dependencies

## Quick Start

Requires **Node.js 24+** and **pnpm**.

```bash
git clone https://github.com/canvasxai/sketch.git
cd sketch
pnpm install
cp .env.example .env
pnpm dev
```

Open `http://localhost:3000` — the onboarding wizard walks you through setup.

## Self-Hosting

Sketch runs as a single Node.js process — the API server and web UI are served together. No separate web server or database required.

See the full [Self-Hosting Guide](SELF_HOSTING.md) for production deployment with systemd and Caddy.

## Architecture

```
  Slack / WhatsApp
        |
    Gateway (Bolt / Baileys)
        |
    Message Queue (per-channel, sequential)
        |
    Agent Runner
        |
    Claude Agent SDK
        |
    Workspace (scoped files, tools, memory)
```

Each user gets an isolated workspace at `data/workspaces/{user_id}/`. All tool calls go through `canUseTool` which validates file paths and permissions — no agent can escape its sandbox.

## Supported Channels

| Channel    | Status |
|------------|--------|
| Slack      | Stable — DMs, channels, threads |
| WhatsApp   | Stable — DMs and groups |

## Tech Stack

| Component  | Technology |
|------------|------------|
| Runtime    | Node.js 24, TypeScript |
| Agent      | Claude Agent SDK |
| Database   | SQLite (Kysely) |
| HTTP       | Hono |
| Frontend   | React, Vite |
| Build      | tsdown, pnpm monorepo |
| Lint       | Biome |
| Test       | Vitest |

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, code style, and PR guidelines.

## License

MIT — see [LICENSE](LICENSE).
