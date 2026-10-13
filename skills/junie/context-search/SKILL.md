---
name: context-search
description: "Semantic code search over the whole repository for behaviour questions: which code implements a described behaviour, which shared mechanism is behind it, where a similar case is handled. Returns ranked code blocks with file paths and line ranges.\n- Not a name lookup: for known class, method or file names, definitions and usages use grep or glob."
argument-hint: question

---

# Semantic Code Search

`jbcontext search` answers "which code does X" questions with the most relevant code blocks of the repository, ranked best first. Each result has the file path, the line range and the code.

## Usage

```bash
jbcontext search --limit 6 "<6-12 word question about behaviour, with names from the task>"
jbcontext search --limit 6 -p <dir> "<question>"   # <dir> is relative to the repository root
```

## Rules

- Ask about behaviour, not a name: "where a renamed branch updates the upstream it tracks", not "GitBranchRenameHandler". For a known name use grep or glob.
- Open the top results at the shown lines; do not find the same file again with grep or glob.
- One question per search; if the results are off, rephrase once with other terms.
- Once you have read the code you will change, edit it before searching for anything new.
- Run it from the repository root, without `cd`.
