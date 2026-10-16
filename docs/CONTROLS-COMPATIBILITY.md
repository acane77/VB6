# Browser control compatibility

This audit concerns `src/controls`, not native Win32/AppKit exporters. The base
is main `a7468b43119c2e46ccd38c1a5ba6e1504b989947`, tree
`23d096bed92bb464b85a0e82b1f05f0e770a43ea`. Existing OCX sites, WebBrowser,
RichTextBox, designer tabs, native data binding and themes must be preserved.

## Audit findings

The initial browser implementation silently approximates several common-control
contracts. Sorted ListBox insertion sorts labels without their ItemData; removing
an entry loses selection identity; fractional indices are accepted. TreeView
ignores sibling placement and has incomplete node navigation. EnsureVisible
selects instead of only revealing. ListView is always rendered as a report,
programmatic selection and item selection disagree, and column clicks sort even
without application code. Collection key changes bypass uniqueness checks.
Toolbar button styles and status panel input are incomplete. Grid RowHeight is
fixed; range selection and Clip zero endpoints require correction. Date controls
need bounded date conversion and keyboard behavior.

## Acceptance

Changes require deterministic model regressions, actual browser pointer/keyboard
checks through the production runtime, strict reproducible artifact fingerprints,
and the repository's complete Validate workflow at the final integrated head.
Tests must retain failure records, validate error paths and avoid treating source
inspection as runtime execution. A draft or partially published checkpoint is not
mergeable.

## Compatibility boundary

This audit is not a claim of complete Microsoft VB6/OCX parity. Browser-specific
limits include arbitrary native OCX/COM hosting, operating-system common-dialog
and printing behavior, native text/graphics pixel equality, and external provider
services. MSChart's full chart object hierarchy and all chart types, hierarchical
grid bands, every rich text/OLE object format, and every common-control property
remain separate acceptance items unless implemented and tested explicitly.

## Reference contracts

Microsoft's Visual Studio 6.0 Windows Controls documentation: Add for Nodes
(`aa443386`), ListItems (`aa443222`), ListSubItems (`aa443223`), ColumnHeaders
(`aa443195`), Buttons (`aa443104`) and ButtonMenus (`aa443211`). An archived
Microsoft-authored copy is at
https://ok5nw.nagano.cz/vb6/language_reference/methods/methods_a.pdf . In particular,
Nodes use creation-order indices separate from sibling/display order, all five
relative placement modes, and a default tvwNext relationship. No Microsoft source
code or native artwork is incorporated.
