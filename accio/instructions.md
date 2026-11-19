## Structural Code Navigation (jbcontext)

`jbcontext` also answers structural questions about a declaration whose name you already know (from the task,
a `jbcontext search` result, or a file you have read). These commands work from an index of declarations: they
find the declaration itself and label each use (call, read, write, import) instead of returning every line that
contains the text.

{{ACCIO_TOOLS}}

### When to use

Use these commands, not grep or rg, for three questions about a known declaration:

- Who uses it (callers of a function, reads and writes of a field, imports of a class): `jbcontext references`.
- What implements or extends it (implementations of an interface, subclasses, overriding methods):
  `jbcontext implementations`.
- Where it is declared and what its body is: `jbcontext symbol --source-lines`.

### MANDATORY: structural check before editing

Before you edit a function, method, class, interface or field declared in the repository, run
`jbcontext references <Name>` for it. When it is an interface, an abstract or open class, or a method that
subclasses override, also run `jbcontext implementations <Name>`. Read the uses they list and update every one
that your change affects.

For these three questions this section takes precedence over "keyword grep is faster" and over "exact search"
in the section above. Everything else stays as described above: start with `jbcontext search` when you do not
know where the code is, use grep or rg for exact text, string literals, configuration keys and file names, and
read files directly once you know them.

If a command reports an error, or finds nothing for a name you know exists, fall back to grep or rg. The first
line of the output says when results are partial.
