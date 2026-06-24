---
name: context-install
description: Install Context and complete first-time setup — login and configure agent integration. Use when `context` is not found or the user asks to install Context.
---

# Install and set up Context

Use this skill to install the Context CLI and finish first-time setup (login, agent integration).

## When to use

- `context` returns `command not found`
- The user says Context is not installed
- The user explicitly asks to install Context

## Do not use for

- Authentication issues → use `context login`
- Missing project index → use `context index`
- Agent integration only → use `context setup-agent --help`

## Install

### macOS / Linux

```bash
curl -fsSL https://packages.jetbrains.team/files/p/grazi/jetbrains-ai-public-releases/context/download-context.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://packages.jetbrains.team/files/p/grazi/jetbrains-ai-public-releases/context/download-context.ps1 | iex
```

## Verify installation

```bash
context --version
```

## Common follow-ups

### `401`

The user is not logged in.

```bash
context login
```

### `404`

There is no index on the server.

```bash
context index
```

### Agent setup

If the user also wants Context configured for an agent, use `context setup-agent`.

Claude non-interactive setup:

```bash
context setup-agent --agent=CLAUDE --auto --non-interactive
```

Codex non-interactive setup:

```bash
context setup-agent --agent=CODEX --auto --non-interactive
```

Study help for any other agents and options:
```aiignore
context setup-agent --help
```
