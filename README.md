# Context Instructions

A collection of skills, agents, and instructions that integrate Context into agents through hooks, MCP and Agents.md

### Skills


| Skill | Description |
|---|---|
| `context-search` | `/context-search` — run a semantic code search |
| `context-research` | `/context-research` — deep codebase exploration using `context search` and `context history` |
| `context-install` | `/context-install` — install the Context CLI |
| `org-search` | `/org-search` — experimental org-wide semantic search |
| `dependency-search` | `/dependency-search` — org-wide dependency usage and upgrade research |

### Agents

| Agent | Description |
|---|---|
| `context-explorer` | Iteratively explore an unfamiliar codebase with semantic search and return verified `file:line` findings |
| `blast-radius` | Org-wide impact and consumer analysis — find producers, consumers, owners, tests, and related repos for a change |
