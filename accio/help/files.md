# {{JBCONTEXT}} files

Find filenames and paths: `{{JBCONTEXT}} files "pattern" --plain`. Accepts substrings or globs.

## Paths for shell use

Use `--plain` for command substitution and pipelines. It prints one complete project-relative path per
stdout line, without headers, outlines, notes, or directory grouping. Default text output is for display;
do not extract paths from it with `grep`, `head`, or similar text filters.

Quote selected paths, for example `cat -- "$path"`. Read them from the project root, or resolve them
against the project selected with `--project`. Keep stderr separate; do not merge it into the path
stream with `2>&1`. Inspect multiple matches before selecting a file.

Use `--format json` when availability, completeness, or coverage matters. Empty plain output alone
does not establish absence: inspect the structured result and check scope and spelling.

## Scope and results

Use `--scope <path-or-glob>` to narrow searches, `--project <checkout>` for another local checkout,
and `--ref <revision>` for committed code. Air Context semantic search uses its own `-p` / `--path-filter`.
Accio normally searches the working tree and refreshes edited and nonignored untracked files automatically.
Use `--format json` where supported for structured output.
Read availability, quality, completeness, truncation, and coverage notes. Project coverage can be partial
while libraries are building or not loaded; a complete result list does not imply full index coverage.
Out-of-scope or corrected-scope suggestions appear separately as alternatives and are not matches in the
requested scope. Multiple targets have independent numbered text answers. JSON shapes follow the command:
name commands and files return arrays; locate returns one object for one query and an array for several.
Plain output stays header-free. Empty results alone do not prove absence: check scope, spelling, and tool choice.
