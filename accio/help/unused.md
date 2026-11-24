# {{JBCONTEXT}} unused

Find potentially unused declarations: `{{JBCONTEXT}} unused --scope src/`. Results are leads to verify, not proof that deletion is safe.

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
