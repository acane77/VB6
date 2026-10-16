# Optional XAML form authoring

## Enable and open

Open **Tools > Options > General > Layout Extensions** and check **Enable XAML
form authoring (this project)**. Confirm with OK and save the project. The single
gate is `settings.xaml === true`; omitted, false and string values are disabled.
It is independent of `settings.anchoring`. Grid/StackPanel lowering additionally
requires the anchoring/automatic-layout extension.

With a form active, choose **View > XAML Source**, or the form designer's **XAML
Source** context-menu command. The source opens in an ordinary MDI document tool.
Disabling the feature closes/removes its tools and commands without deleting the
stored source. Existing projects stay classic by default. The opt-in checkbox is
always available in Options; XAML editing UI is hidden when disabled.

## Data flow and editing

The standalone `@vb6/xaml-compiler` package parses XML/markup into syntax nodes,
resolves an extensible type schema, binds members and emits typed construction IR.
The separate `src/xaml/forms.js` adapter lowers supported IR into the **existing
VB6 form model**. It does not replace the designer, Properties grid, runtime,
Win32 or macOS compiler, or HTML export renderer with a WinUI renderer.

Valid source edits update the form, property inspector and conventional VB6
names/event procedures in one shared undo transaction. Revisions and exact
canonical model stamps prevent stale proposals from replacing newer models.
Designer/Properties changes update XAML before the existing history transaction
captures its after state. Typed edits are coalesced through the same history.
Control-array renames require all same-name members to change together.
Code renaming reuses the IDE's `EditorIntelligence` declaration/type/With-block
resolver. Bound form/control references, event-shaped procedure declarations and
calls, native member attributes, bracketed identifiers and typed form instances
are updated simultaneously. Other forms' controls, local shadows, unrelated
object members, comments and strings remain unchanged. Name capture and symbol
collisions reject the entire proposal. Inactive conditional branches containing
a candidate name require review rather than being guessed from the active build.

Invalid or incomplete source is retained as a **draft**; the last valid controls
remain intact. An active unresolved draft blocks Run/build/export rather than
silently building different controls. Designer changes while a draft is pending
preserve that draft and mark a conflict. **Apply Draft** explicitly overwrites the
model after successful compilation; **Use Designer** explicitly regenerates the
source. The previous source is retained for **Restore Previous** recovery.
Disabling XAML makes its metadata dormant, so the ordinary form model can run.

Native scalar/property-element/JSON edits, additions, subtree deletions and flat
z-order changes patch original source spans, retaining unaffected comments,
namespace aliases, quote delimiters and line endings. New native controls and menu
collections can be inserted into self-closing or explicit collection containers.
WinUI scalar edits retain the authored WinUI tree and resources; editing a shared
style's value on one control creates a local value instead of modifying the
shared Setter. Native-only changes remain explicit `vb:Designer.Properties` data.
Every candidate is recompiled and its complete canonical model compared with the
designer before acceptance. Reparenting, type changes, rich property content or
other changes that cannot be preserved safely regenerate native XAML with an
original-source backup. This is not arbitrary lossless textual round-tripping.

The source editor has syntax highlighting, diagnostics, completion (Ctrl+Space),
hover (Ctrl+I), definition (F12), references (Shift+F12), rename (F2), formatting
(Shift+Alt+F), outline navigation, literal find/replace, indentation, shared undo,
IME/native selection and read-only run/lock states. Cursor/designer selection
synchronizes with Properties without stealing focus. The language service also
exports folding ranges; the custom textarea editor does not project folded text.
Analysis caches whole-document snapshots, not incremental syntax subtrees.
File imports and confirmation dialogs recheck project identity, editor/source
revision, designer revision and writability after awaiting user/file activity.
Document state validation is shared by editing and build/export preflight; source,
applied source, backup and model stamp are bounded, revisions cannot overflow,
and multi-form synchronization publishes no partial authoring-state updates.
Lowering also counts each expanded native node before retaining it or visiting
further children, including JSON escaping, so repeated resources stop at the
model budget rather than first constructing an oversized complete model.

## Native vocabulary and persistence

Native forms use `xmlns:vb="urn:vb6:forms"`, for example:

```xml
<vb:Form xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
         xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
         xmlns:vb="urn:vb6:forms"
         Name="Form1" Caption="Example" Width="6000" Height="4500">
  <vb:CommandButton Name="Command1" Caption="Save"
                    Left="240" Top="240" Width="1200" Height="375" />
</vb:Form>
```

Native geometry remains **twips**; native Boolean flags remain **0/-1**. Native
Name/Index pairs preserve control arrays. Stable `vb:Designer.Id`, flat storage
order, menu ownership, parent IDs and native metadata remain round-trippable.
Unknown/custom controls use a generic native Control plus explicit Type metadata;
this preserves their model data, it does not manufacture runtime support for a
previously unsupported OCX. Unknown properties/state use bounded JSON metadata.
Original property ordering is retained where it affects `.frm` serialization.

The versioned document is stored in `module.xaml` inside `.vb6web`, including the
current/applied text, revision, model stamp, conflict and previous-source backup.
Native `.frm`/`.vbp` export uses the compiled form model. There is currently **no
XAML-source companion sidecar for native project file saves**; save `.vb6web` or
use Download XAML to retain authoring text when working with native exports.
Standalone application export strips authoring state from its private project
snapshot; it neither leaks drafts nor mutates the saved project.

The shared VB compiler facade adds a cheap authoring-state preflight for VM/AOT
callers; its original compiler is unchanged in `compiler-core.js`. This contract
has no XAML schema/parser/IDE dependency. Existing export/runtime limits remain.

## WinUI conversion boundary

The package recognizes a representative built-in schema vocabulary. Its
host object writer supports extensible construction and explicit resource,
binding/event/template hooks; these contracts are not a WinUI UI implementation.
The VB6 adapter supports selected forms/containers/basic controls, scalar text,
geometry, flags, colors, typography, conventional native event method names,
static resources/styles and selected Grid/StackPanel layout metadata.
WinUI dimensions convert at the existing 96-DPI convention (15 twips per DIP),
font size at 0.75 points per DIP; native attributes do not undergo that conversion.

Unsupported members, dynamic bindings/x:Bind execution, control/data templates,
animations, theme resources, deferred loading, arbitrary handler forwarding,
unsupported control APIs and unlowered layout behavior are **diagnostics**. They
are not discarded or replaced with blank controls. No XBF/WinMD compatibility,
MSBuild integration, C#/C++ binding generation, complete WinUI type inventory,
WinUI dependency-property/rendering runtime or full Microsoft compiler parity is
claimed. This is an independent JavaScript implementation, not a verbatim port
of Microsoft's C# compiler sources.

### Static styles and resources

Explicit/implicit/inline styles, `BasedOn`, base-class target compatibility, local
value precedence and explicit `Style="{x:Null}"` suppression are supported.
Setters are converted to the consuming member's type. Implicit matching uses the
resolved namespace/type identity, not an XML prefix spelling. Merged dictionaries
are recursive: local keys win over merged dictionaries; later merged dictionaries
win over earlier ones. Resource/setter evaluation retains declaration scope, so a
consumer's resource shadow does not silently change an outer style. Cyclic
resources/styles, missing keys, invalid conversions, incompatible targets and
unsupported behavioral setters produce errors. Opaque solid brushes are supported;
opacity/transforms are not silently discarded. External dictionary I/O, theme
switching, triggers and template execution are not added by this static adapter.

### Layout and item collections

Grid defaults to one row/column, with children in cell zero rather than native
auto-placement. StackPanel defaults retain main-axis natural sizing, cross-axis
fill and no flex shrink. Explicit fixed dimensions and supported Auto sizing,
margin/container-padding thickness, cross-axis/grid alignment, gaps, tracks and
cell/span metadata lower through the existing opt-in layout engine. Resource-backed
row/column definitions use the consuming GridLength converter, including star,
auto and pixel values. Negative
margins/padding, unsupported content padding and unrepresentable alignment are
diagnostics. These mappings do not implement every WinUI measure/arrange rule.

ListBox/ComboBox accept string items and simple text-only item containers, initial
selection and list selection mode. ComboBox is non-editable by default and its
initial selected item populates Text. Styled/rich item containers, conflicting or
out-of-range initial selection, and multiple initially selected item containers
are rejected. Vertical ScrollBar/Slider orientation and positive slider step
frequency are lowered to the existing controls.

## Validation commands

```sh
node --test tests/xaml-*.test.mjs
node tools/test-xaml-package.mjs
npm test
python tools/browser-xaml-tests.py
```

The browser suite defaults to real local HTTP. It accepts the explicit
`VB6_TEST_TRANSPORT=memory` mode for environments that prohibit browser network
navigation; reports label this transport and it does not establish HTTP/file
origin acceptance. Chromium/Firefox/WebKit selection follows `VB6_BROWSER`.
Package checks pack the real standalone package and import it outside the repo,
then type-check a consumer when `tsc` is installed. The package is not published.

All bundled example projects have form-model and byte-identical generated
`.frm` round-trip regressions. New browser tests exercise actual source editing,
Properties, designer moves, options, conflict/draft handling, undo/redo, shared
style isolation, lists, stale imports/confirmations and a real exported
application's event execution. Those checks do not certify native
Windows/macOS execution, universal WinUI visual parity or every legacy OCX.

## Remaining conformance work

Full Microsoft compiler parity still requires a versioned WinMD/schema importer,
complete XAML directives/markup compatibility, typed x:Bind semantic analysis and
code generation, XBF compatibility if retained as a target, all-target resource
and template semantics, complete control/member lowering and upstream differential
fixtures. IDE follow-ups include incremental/background analysis, projected code
folding, native project source sidecars and broader real-origin multi-browser
acceptance. Keep these separate from tested native model round-tripping.

## Implementation map

`src/xaml/contract.js` is the schema-free authoring/build preflight.
`static-values.js` resolves compile-time dictionaries, typed constants and styles.
`forms.js` owns native serialization and IR lowering; `source-edits.js` plans
source-preserving edits without mutating a project. `rename.js` adapts the existing
VB editor resolver; `documents.js` stages atomic form/code/document proposals.
`src/ide/xaml.js` integrates these with the existing options, designer and history.
No npm publication or new XAML engine in application exports is required.

Style/resource behavior is independently implemented with reference to
[Microsoft's XAML styles documentation](https://learn.microsoft.com/windows/apps/design/style/xaml-styles)
and [merged resource dictionary documentation](https://learn.microsoft.com/windows/uwp/design/controls-and-patterns/resourcedictionary-and-xaml-resource-references).
The explicit VB6 target boundaries above take precedence over assumptions based
on the standalone compiler's larger vocabulary.
