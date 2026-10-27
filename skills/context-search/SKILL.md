---
name: context-search
description: "Semantic code search for discovering and understanding code by meaning rather than keywords.\n- Use this skill when you need to find code whose location you don't already know - e.g., when the task asks 'where is X', 'how does Y work', or describes behavior or intent without naming exact symbols.\n- When not to use: if you already know the relevant file, class, or symbol (use direct navigation or keyword search instead), or for non-code-discovery tasks such as git operations, builds, tests, or reviewing an existing diff."
argument-hint: query

---

# Semantic Code Search

Use `jbcontext search` to find code snippets by meaning, not just keywords.

Use it as a single semantic bootstrap when the relevant file or subsystem is unknown. Do one focused search, open and inspect at least one returned file locally, and inspect nearby code in that same directory or subsystem before any retry. If that still does not identify the needed adjacent area, do a narrowed retry with `jbcontext search -p <path> ...` using the directory of the best first hit.

## Usage

```bash
jbcontext search "<detailed and descriptive query>"
jbcontext search "<code snippet>" # find similar snippets
jbcontext search -p <path> "<query>"  # <path> must be relative to the project root
```

## Query Tips

Before searching, translate the research task into the one code responsibility you need to locate next. Describe that code in concise natural language rather than forwarding the whole assignment as the query.

- Describe the operation, its subject, and the constraints that distinguish it from nearby code. Preserve useful domain terms and exact identifiers supplied by the task or observed in code; avoid keyword bags and guessed names.
- If the task spans endpoints, persistence, configuration, callers, or tests, choose the responsibility needed first. Read the results and follow local references before searching for another responsibility that remains unresolved.
- Keep a related precondition, return value, or failure case when it describes the same operation. Do not split a coherent behavior merely because its description contains "and".
- Keep requests for explanations, output formatting, and a final report outside the search text.
- For a feature that does not exist yet, search for the existing mechanism to extend rather than assuming the desired implementation already exists.

Examples:

- Focused: "retrieving a user's learning progress for a particular course"
- Focused: "HTTP handlers receiving and storing uploaded IDE analytics"
- Focused: "moving downloaded distributions atomically with a fallback when atomic moves are unsupported"
- Too many responsibilities: "Where are course endpoints and how is user course learning progress recorded and returned?"
- Too many responsibilities: "Find the upload endpoints, data storage, configuration, and related tests"

Question phrasing is fine when it has one clear retrieval target; there is no fixed word limit.

## Examples

```bash
# Find authentication-related code
jbcontext search "user authentication login flow"

# Narrow to specific directory
jbcontext search -p src/auth "JWT token validation"
```