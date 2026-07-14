---
name: context-search
description: "Locate code in an unfamiliar codebase using semantic search"
argument-hint: query

---

# Semantic Code Search

`jbcontext search` finds code by meaning, not keywords. It is your **primary tool for
locating code** whose position you don't already know — use it **iteratively** until you
have pinned down the exact file, class, or method to change. It is not a one-time
bootstrap.

## How to use it

- Start with one broad natural-language search for the issue's named feature, class, or
  behavior.
- Open the top hit and read the code around it. If that identifies what to change, stop
  searching and start reading/editing.
- If it does **not** pin down the target, **search again immediately** — narrow to the
  best directory with `-p <path>`, or rephrase the query. Keep refining until the target
  is located.
- Do **not** fall back to `grep -R`/`rg`/`find` to hunt across the tree while you are
  still unsure where logic lives — that is exactly what search is for. Reserve
  `grep`/`sed` for reading inside a file you have **already located**.

Re-searching is cheaper than a sweep of manual greps: each refined search replaces many
`grep`/`find` commands. Prefer 2–4 focused searches over dozens of local-discovery
commands.

## Usage

```bash
jbcontext search "<query>"              # broad: locate by meaning
jbcontext search -p <path> "<query>"    # narrow to a subsystem; <path> is relative to the project root
jbcontext search "<code snippet>"       # find similar snippets
```

## Query tips

- Keep queries short — 5–10 words naming the feature or behavior retrieve as well as long
  sentences.
- Name the concept, not a bare keyword: "validate user email address" > "email".
- When you already know the subsystem, add `-p <path>` instead of lengthening the query.

## Output discipline

Do not announce that you are about to search or restate the results. Run the search, read
the hit, and act.
