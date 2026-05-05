---
name: embark-review
description: "Use this skill to review code changes using semantic search to understand context and impact"
---

Use EmbArk as a bootstrap for unknown areas, not as a repeated broad-search loop.

## When to Use

- Before committing changes to understand what you're about to commit
- Reviewing pull requests or branches
- Understanding the impact of changes on the rest of the codebase

## Review Workflow

### 1. Check Current Changes

First, see what's changed:

```bash
git status
git diff                    # Unstaged changes
git diff --staged           # Staged changes
git diff main...HEAD        # All changes on current branch
```

### 2. Understand Changed Code Context

For each significantly changed file, use semantic search only when the related area is still unknown. Do one broad search, inspect returned files locally, and inspect nearby files in the same directory before any retry. If that still fails, do at most one narrowed retry with `-p`. Do not reformulate the first broad query into another repository-wide search.

For each significantly changed file, use semantic search to understand:

- **Similar patterns**: Find similar code elsewhere that might need the same change
- **Callers**: Find code that calls the modified functions
- **Dependencies**: Find code that the modified code depends on

```bash
# Find similar patterns
embark search "<code chunk that was changed>"

# Find callers of a modified function
embark search "calls to <function name> to understand impact"

# Find related test files in the "test/" directory (path must be relative to the project root)
embark search -p test "tests for <feature being modified>"
```

### 3. Review Checklist

For each change, verify:

- [ ] The change is consistent with similar patterns in the codebase
- [ ] All callers of modified functions will still work correctly
- [ ] Related tests exist and cover the changes
- [ ] The change doesn't reintroduce previously fixed bugs

## Example Session

```bash
# See what's changed
git diff --staged

# For a change to auth middleware, find similar patterns
embark search "authentication middleware pattern"

# Find what calls this middleware
embark search -p src/auth "uses auth middleware to protect routes"

# Find related tests
embark search -p test "auth middleware test"
```
