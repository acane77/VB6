# Original VB6 projects and project groups

VB6 Studio Web can open native `.vbp` projects and `.vbg` project groups alongside `.vb6web`, `.vb6proj`, and recognized JSON browser snapshots. The native interchange layer preserves imported source and companion files rather than converting the entire project into freshly generated text on every save.

## Open a complete workspace

Use **File > Open Project** and select a ZIP containing the project tree, or select the project and its source/resource files together. **Open Project Folder** reads a user-selected directory where supported, with a directory-input fallback. Drag-and-drop accepts the same selected files and ZIPs. The native/web import dialog selects the entry project or group and the original source encoding. Importing never follows a path to an unselected file or downloads a dependency.

Include source files and their companions: `.frm/.frx`, `.bas`, `.cls`, `.ctl/.ctx`, `.pag/.pgx`, `.dob/.dox`, `.dsr/.dsx`, `.res`, `.vbw`, related documents and other project data. Arbitrary selected companion files are retained, including formats the browser cannot interpret. A folder scan skips `.git`, `node_modules`, and the reserved `.vb6-save-journal` recovery directory.

Relative paths are resolved case-insensitively inside the selected workspace. Unquoted filenames can contain literal apostrophes (for example, `O'Brien.frm`); an apostrophe preceded by whitespace starts a manifest comment. Quote paths containing ambiguous whitespace/apostrophe combinations. Keep the common parent directory when projects share files. An absolute, parent-escaping, or missing relative source reference can be relocated to a uniquely named file that was explicitly selected; diagnostics report the relocation and export updates that reference. Ambiguous or absent files are not guessed or fabricated. Missing entries and unparseable files remain in the native manifest, with diagnostics and a bounded read-only viewer for retained files that could not be opened as modules.

## Save without losing the original format

**Save Project** uses the active save format. Native imports initially save a ZIP of original-format files; browser snapshots initially save `.vb6web`. **Save Project As** offers a browser snapshot, native ZIP, or native folder. Explicit **Save Native VB6 Project**, **Save Native VB6 Folder**, and **Save Browser Project** commands are also available. A ZIP can be extracted and opened in the original IDE when its dependencies and features are supported there.

Browser snapshots retain the native preservation metadata and binary companions, so opening a snapshot and exporting native sources does not require importing the original files again. **Export Sources** includes both native files and a browser snapshot. Saving one source module includes available companions in a ZIP when needed.

Unchanged imported files are returned byte-for-byte, including their BOM, line endings, comments, attribute records and opaque data. Edited supported form properties and source text are patched into the original designer/source envelope. Membership additions, removals and path changes update the VBP while unrelated settings, duplicate records and vendor sections remain intact. **Project > Native Project Settings** edits native `key=value` settings, including duplicate records. Project name/startup, membership and references use their dedicated project tools or the project model APIs.

Hidden module, procedure, Event, module-variable and property-accessor attributes are retained and can be edited through module metadata. Attributes follow complete logical declarations, including explicit line continuations and comma-separated variables. Imported accessor and conditional-branch ownership is preserved; new ambiguous owners are rejected rather than guessed. Fresh browser-class export emits each property attribute once, preferring its Get accessor when no imported owner exists. An edit that removes or renames a declaration owning hidden attributes is rejected unless the attributes are also removed or retargeted. Unsupported structured browser-only property values are rejected on native export instead of silently discarded; a browser snapshot remains available for such projects.

## Encodings and resources

Select the original Windows code page for projects created in another locale. Auto mode recognizes BOMs, treats non-ASCII valid UTF-8 as UTF-8, and otherwise defaults to Windows-1252; ASCII source also defaults to Windows-1252. Auto-detection cannot identify every legacy code page. UTF-8/UTF-16 and the listed Windows and East Asian encodings are supported. Unchanged bytes are retained even where multiple byte sequences decode to the same text. An edited character that cannot be represented in the selected encoding causes the whole native export to fail; it is never silently replaced with `?`. Unicode BOM support is an interchange feature, not a claim that every original VB6 installation accepts those encodings.

Known FRX-family text/list/image bindings and RES entries are decoded for the supported editors. Edited known FRX-family values are appended and their source offsets updated, leaving opaque portions intact. Unknown binary blobs remain unchanged. Moving an imported form to another source directory rebases its unchanged opaque resource references to their retained companions. A move with an unavailable companion fails instead of exporting a dangling reference. Explicitly edited references are interpreted relative to the new source location. This is not a general editor for every OCX persistence format.

## ZIP interchange

Import accepts single-disk STORE and DEFLATE archives, including bounded ZIP64 records and signed or unsigned streaming data descriptors. Unflagged legacy entry names normally use CP437; the UTF-8 flag and valid, CRC-matched Info-ZIP Unicode Path extra fields take precedence. For an unmarked Windows-codepage archive, use **File > Open ZIP with Filename Encoding...** and explicitly select its filename encoding. This setting is separate from source text encoding. It resolves ambiguity without claiming reliable automatic detection; unsupported producer mappings still require external extraction and folder import.

Central and local headers, record sizes, checksums, directory boundaries, duplicate/unsafe paths and expansion limits are validated. Metadata for all entries is checked before decompression, including case-insensitive file/directory prefix conflicts. Explicit ZIP limits must be nonnegative safe integers; NaN and Infinity cannot disable them. Small archives produced using forced ZIP64 are accepted without lifting the existing size limits. ZIP export remains conventional UTF-8 STORE, suitable for independent tools; it does not produce ZIP64. Multi-disk, encrypted and other compression methods are rejected with diagnostics.

## Project groups

Use **Project > Create Project Group...** to wrap the current, possibly unsaved
project in a native `.vbg`. **Project > Add Existing Project to Group...** adds
another VBP and its supplied source/companions without discarding current edits.
The project toolbar's **Active project in group** selector switches projects.
**Project > Project Group...** stages display reordering, removal, VBP path
changes, and active/startup selection; Cancel leaves the workspace unchanged.
Dialogs and file pickers reject a stale snapshot rather than overwrite edits
made while they were open.

Removal detaches membership; the latest exclusively owned source and companion
bytes remain in the workspace for export or re-addition. It never deletes files
from disk. Moving a VBP rebases its member/resource paths, known relative library
and explicit component paths, and source-project references from other members.
Bare registered OCX names, absolute system paths and unknown vendor references
remain metadata; none are opened or activated. A known relative reference that
cannot be resolved inside the selected workspace blocks a move instead of
silently changing its meaning. The old VBP is omitted from the new archive;
folder saves remain non-destructive and may leave the old on-disk VBP behind.
Unknown VBG records, unresolved memberships, comments and vendor sections survive.
A no-op reorder preserves the original manifest bytes.

Removal also preflights the whole group's shared output. It cannot discard the
only edited copy of a shared source, RES or opaque FRX, or hide an existing
conflict by removing one author. Such a removal is rejected without changing
workspace or history; save and reopen the group to synchronize shared copies
before detaching that project. Identical shared edits, and edits already owned
by a surviving member, do not prevent removal. Generated relative reference
paths are quoted when needed, including names containing whitespace-delimited
apostrophes, so relocation survives native export and reimport.

The dialog shows a stable dependency order derived from explicit `*\A` project
references, with separate diagnostics for missing group members, actual cycles
and projects blocked by cycles. This is planning metadata, not a multi-project
compiler/linker: the browser still runs one active project at a time and does
not provide native cross-project COM debugging.

Saving writes the group, its projects, shared source and retained companions
together. One changed copy of a shared file is used; divergent edits to the
same shared path cancel export. Per-project source undo, open documents,
breakpoints and watches survive switching and manifest moves, keyed by stable
project identity. Group membership/path changes use a shared undo barrier: undo
later edits in every participating project before undoing the group change.
Redo checks the corresponding history order. Discarded/evicted peer history
fails closed rather than restore a snapshot that could erase newer work.

### Reusable project APIs

`src/project/workspace.js` exports pure, clone-returning transactions:
`createProjectWorkspace`, `addWorkspaceProject`, `removeWorkspaceProject`,
`reorderWorkspaceProjects`, `setWorkspaceStartup`, `moveWorkspaceProject`,
`workspaceDependencies`, and `workspaceBuildOrder`. The last helper rejects
missing/cyclic dependencies rather than return an executable plan. File output
is preflighted before a structural transaction is accepted. Workspace order and
startup must name existing members; nested groups, duplicate identities/names on
add, conflicting outputs and more than 32 projects are rejected. No operation
obtains filesystem permissions, executes a dependency, or writes a destination.

`WorkspaceHistory` in `src/project/workspace-history.js` implements structural
barriers over the host's existing bounded `History` object. Session/view state
is process-local and is not serialized into project files. The IDE installs
these operations through `installProjectGroups` rather than coupling the core
workspace library to browser controls.

## Add Existing source dependencies

Adding source files is one transaction across modules, references, binary
companions, decoded RES entries, related-document memberships, portable data
connections/commands and virtual data files. The target's name, startup,
settings and reference priority remain authoritative. Known incoming relative
reference paths are rebased to the target VBP. Identical binary companions are
compared by decoded bytes while retaining the target's path spelling.

RES entries merge by type, name and language. Independent string IDs within a
shared 16-slot string-table block combine; conflicting nonempty string slots or
opaque payloads reject the import. RelatedDoc paths remain explicit VBP members,
not merely loose bytes. Missing or read-only native source memberships must be
opened as their own project instead of added: an Add Existing operation will not
silently drop those records. Conflicts leave both input projects unchanged.

## Filesystem safety and limits

Folder writes require an explicitly granted directory handle. Output paths are validated before writing, and Windows-reserved names, traversal and case-insensitive collisions are rejected. File/directory prefix conflicts are rejected before native writes or recovery. Freshly generated VBP metadata is also validated: multiline values, disguised reserved setting keys and invalid membership kinds cannot inject records. Binary resource decoders verify the decoded 20 MiB bound as well as the encoded input size. All expected destination files are compared before the first write, including unchanged source/resource dependencies, and changed targets are checked again before each write. Dependencies are rechecked before each manifest phase and after the final write. A concurrently changed unchanged file therefore cannot silently yield a successful save. Sources/resources are written before VBP files, and VBG files last. Unrelated destination files are not deleted. Cancelled or failed saves leave the project dirty, and choosing Save in a discard prompt only proceeds when saving succeeds.

Recoverable saves stage original and intended bytes in a SHA-256-verified `.vb6-save-journal`. A failed publication attempts conflict-aware rollback; unresolved journals remain for **File > Recover Native Folder Save...**, which offers restore, complete, or cancel. Recovery invalidates the IDE's saved baseline before disk writes, so later dirty-state recalculation cannot mistake the old in-memory snapshot for the recovered disk state. Cleanup failure after a verified publication reports a pending journal instead of rolling back a completed save. See [the recovery contract](NATIVE-WORKSPACE-INTEROP.md#recoverable-multi-file-folder-saves).

A directory save is **not an atomic transaction**: other processes can observe intermediate files or change them between checks. Recovery refuses unrelated external bytes and retains unresolved backups. An immutable single-file alternative is `npm run snapshot:native -- SOURCE_FOLDER NEW_OUTPUT.zip`; it flushes a private temporary file before exclusive publication without replacing an existing backup. Neither path claims power-loss certification. A browser download means the download was initiated, not that the IDE can verify its eventual destination file.

Imports are bounded to 20 MiB per file, 50 MiB total and 2,000 files; groups are bounded to 32 projects and 50 MiB of referenced source across projects. Folder nesting is limited to 16 levels. Individual source modules and designer trees also have parser/normalizer limits. These are explicit safeguards, not unlimited project-size support.

## Compatibility boundary and validation

File preservation is separate from execution compatibility. Opening a project never activates native COM/OCX dependencies, installs type libraries, or executes proprietary designers. Trusted embeddings may install JavaScript control/Automation adapters; the separate opt-in x86/x64 Windows host can activate explicitly allowed installed components. Those APIs are not automatic native execution in the hosted browser. UserControl, PropertyPage, UserDocument and DSR envelopes remain subject to their documented source/designer contracts; arbitrary proprietary persistence requires component-specific adapters.

Recognized `.vbw` records restore in-page code/designer document windows, while unknown records remain preserved. The Window menu can explicitly restore or capture native document visibility, rectangles and maximized state for a subsequent save. This does not reconstruct machine-specific registry settings, add-in windows, tool docking or monitor topology.

Run `npm test` for the complete regression suite, `npm run test:project-files` for focused interchange/filesystem tests, and `npm run test:project-browser` after `npm run build` for real browser import, editing and download workflows against HTTP and standalone `file://` builds. Set `VB6_BROWSER=firefox` or `webkit` for those engines. Directory integration uses real origin-private filesystem handles over HTTP; it does not automate an OS folder picker. `VB6_TEST_TRANSPORT=memory` is an explicitly separate sandbox smoke mode and does not certify HTTP or file-origin behavior.

The canonical Validate workflow runs `project-authoring` on Chromium, Firefox and WebKit; the script exercises both real HTTP and standalone file origins. Capability-dependent OPFS checks explicitly report skips on unsupported origins/engines, not simulated passes. The workflow audit requires this suite to stay owned. Regression fixtures cover native byte preservation, transactional groups, cross-project undo barriers, dependency rebasing, additive resources, encodings, attributes, membership, folder conflicts, recovery journals, workspace state and malformed input. See [workspace and host contracts](NATIVE-WORKSPACE-INTEROP.md) and [validation procedures](TESTING.md). No proprietary Windows VB6 IDE is bundled. The licensed compile/reopen harness requires an actual owner-run licensed installation; successful staging or a skipped job is not certification.

## Workspace and optional host interoperability

See [Native workspace and interoperability](NATIVE-WORKSPACE-INTEROP.md) for explicit unmarked ZIP filename encodings, VBW document-window restoration/capture, staged recoverable folder saves, an immutable ZIP publication alternative, trusted JavaScript component factories, opt-in Windows Automation/ActiveX, and the owner-run licensed VB6 oracle. These additions preserve opaque content and do not imply automatic native-code grants or universal binary compatibility.

## Interchange maintenance notes

The logical declaration mapper is not a compiler and does not evaluate
conditional expressions. Preserve imported textual branch/accessor ownership;
reject edits whose metadata owner becomes ambiguous. Unknown attributes can
still be preserved on a no-op save. Manifest path parsing must preserve leading
or embedded apostrophes in unquoted VBP/VBG filenames while accepting
whitespace-delimited manifest comments.

Older browser snapshots without a resource-reference record use retained VBP
membership paths when available. Without either that path or an original source
path, an unknown original resource directory cannot be reconstructed. Do not
invent a relocation or silently drop an opaque companion.

Keep ZIP interoperability checks independent of the implementation: fixtures
use independent CRC/DEFLATE construction and Python `zipfile` inspection of
actual browser downloads. Cover local/central header agreement, Unicode Path
CRC, legacy filename encodings, bounded ZIP64, descriptors, overlaps and
preflight before decompression. Preserve dirty state and conflict checks on all
folder-save dependencies, including byte-unchanged files. Save-recovery tests
must recalculate dirty state after disk restoration, not only inspect a
transient flag.

Format references: [PKWARE APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
(records/descriptors, ZIP64, Unicode Path and character encoding), Microsoft's
[logical-line guidance](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/too-many-line-continuations)
and Rubberduck's [VB_Attribute conventions](https://github.com/rubberduck-vba/Rubberduck/wiki/VB_Attribute-Annotations).
These explain interchange conventions; they are not a licensed VB6 compiler or
IDE oracle. Native Automation checks and consent are documented in the
[workspace guide](NATIVE-WORKSPACE-INTEROP.md).
