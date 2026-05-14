---
name: embark-install
description: Install Embark and complete first-time setup — login, index the project, and configure agent integration. Use when `embark` is not found or the user asks to install Embark.
---

# Install and set up Embark

Use this skill to install the Embark CLI and finish first-time setup (login, project index, agent integration).

## When to use

- `embark` returns `command not found`
- The user says Embark is not installed
- The user explicitly asks to install Embark

## Do not use for

- Authentication issues → use `embark login`
- Missing project index → use `embark index`
- Agent integration only → use `embark setup-agent --help`

## Install

### macOS / Linux

```bash
curl -fsSL https://packages.jetbrains.team/files/p/grazi/jetbrains-ai-public-releases/embark/download-embark.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://packages.jetbrains.team/files/p/grazi/jetbrains-ai-public-releases/embark/download-embark.ps1 | iex
```

## Verify installation

```bash
embark --version
```

## Common follow-ups

### `401`

The user is not logged in.

```bash
embark login
```

### `404`

There is no index on the server.

```bash
embark index
```

### Agent setup

If the user also wants Embark configured for an agent, use `embark setup-agent`.

Claude non-interactive setup:

```bash
embark setup-agent --agent=CLAUDE --auto --non-interactive
```

Codex non-interactive setup:

```bash
embark setup-agent --agent=CODEX --auto --non-interactive
```

Study help for any other agents and options:
```aiignore
embark setup-agent --help
```
