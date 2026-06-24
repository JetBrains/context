---
name: blast-radius
context: fork
agent: Explore
argument-hint: change or contract query
description: "Experimental Context org-wide blast-radius analysis across multiple repositories. Use when Codex needs to estimate the impact of changing an API, endpoint, schema, event, shared library, config, feature flag, data model, behavior, or dependency by finding producers, consumers, owners, tests, and related repos."
---

Use this skill to research `$ARGUMENTS` across all available repositories when the question is about impact analysis, consumers, producers, compatibility risk, migration scope, rollout planning, or cross-repo ownership.

## Use cases for blast-radius analysis

- **Find consumers before changing a contract.** Given an endpoint, RPC, topic, event, protobuf, schema, enum, table, config key, or shared type, locate repos that publish, consume, validate, transform, or test it.
- **Scope API and behavior changes.** Identify services, clients, SDKs, generated code, docs, tests, and compatibility layers that depend on the current behavior.
- **Plan migrations and deprecations.** Find remaining users of old flags, versions, endpoints, event names, schemas, or dependency APIs before removal.
- **Trace ownership across systems.** Locate the owning repo, adjacent services, deployment config, runbooks, and callers when a request mentions an unfamiliar system.
- **Estimate rollout risk.** Search for feature flag wiring, config defaults, environment overrides, CI workflows, dashboards, or alerts that may need coordinated changes.
- **Find copied logic and duplicate implementations.** Search for similar validation, parsing, retry, auth, serialization, pagination, or error-handling code that might need the same fix.
- **Audit tests and safety nets.** Locate unit, integration, contract, fixture, golden-file, and end-to-end tests that cover the changed behavior.
- **Correlate incidents or bugs across repos.** Find shared error strings, log messages, metrics, spans, alerts, or fallback paths that reveal affected services.
- **Prepare stakeholder notes.** Identify repos searched, concrete matches, owners, likely impacted surfaces, and unknowns that need human confirmation.

## Workflow

0. **Gather possible dependencies, make a discovery about the current project how it can be consumed**

1. **Find candidate repositories first.** Run the experimental repo discovery command:

```bash
context repos "<repo or system terms>" --limit 30
```

Use short, discriminative terms from the request: service names, endpoint names, schema names, event/topic names, package names, team names, product names, or explicit repository names. The shorter the better.

You can omit query completely.

```
context repos
```

2. **Handle prefixed repository families carefully.** If the request mentions a prefix or wildcard such as `jcp-*`, treat it as a repository-family constraint.

- Query the prefix literally, for example `jcp` and `jcp-`.
- Keep all suitable repos whose names start with that prefix.
- Do not replace a prefixed repo family with a similar unprefixed repo unless the repo results clearly show it is the right target.
- Preserve the exact repository `id` returned by `context repos`; do not infer ids from names.

```
context repos "jcp-" # Example: show all repos started with jcp- prefix
```

3. **Select suitable repos.** Prefer exact owner repos, exact consumer/producer repos, prefix-family matches, and repos whose description/path/language/domain matches the changed surface. If there are many candidates, search the most likely 5-10 first, then expand if results are weak.

4. **Search selected repos in parallel.** Invoke `context search` once per selected repository, passing the repository id from `context repo` with the id option supported by the installed experimental CLI:

```bash
context search --repository-id "<repo-id>" --json-output --limit 10 "<semantic blast-radius search query>"
```

If `context search --help` shows a different repository-id flag, use that flag, but still pass the exact id from `context repos`. Run independent repo searches in parallel when the agent environment supports parallel tool calls; otherwise keep results grouped by repository.

5. **Resolve snippets and repo information with `gh`.** When `context search` returns promising snippets, use the GitHub CLI to fetch full source files, surrounding code, default branch, repo metadata, owners, recent commits, or related PRs/issues before relying on the match. Use the GitHub owner/name or URL from `context repo` when available.

```bash
gh repo view "<owner>/<repo>" --json nameWithOwner,description,defaultBranchRef,url
gh api "repos/<owner>/<repo>/contents/<path>?ref=<ref>" -H "Accept: application/vnd.github.raw"
```

6. **Synthesize blast-radius findings.** Report which repos were searched, which repos had useful matches, the strongest producers/consumers/files/symbols found, likely impacted surfaces, and unresolved unknowns. Separate confirmed impacts from plausible leads. If no suitable repo is found, say which repo filters were tried before stopping.

## Search Guidance

- Use semantic, behavior-focused queries for `context search`; avoid one-word searches.
- Search for both names and behavior: endpoint paths, message names, schema fields, event topics, config keys, feature flags, error strings, metric names, and the behavior being changed.
- Search producers, consumers, tests, generated code, docs, and deployment/config paths when blast radius matters.
- Re-run `context repo` with narrower or prefix-aware terms before broadening code search.
- Use path filters only after repo-level matches identify likely directories.
- Keep repository names and ids visible in notes so later searches can be reproduced.
- Use `gh` to resolve snippets into full source context and to gather more information about matching repositories.
