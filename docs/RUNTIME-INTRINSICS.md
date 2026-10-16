# Portable runtime intrinsics and file I/O

This contract describes the portable JavaScript runtime, not unrestricted Microsoft VB6 or native Windows compatibility. The compiler, library signatures, Object Browser metadata, exported runtime and debugger share the implementations described here. Existing native-host restrictions remain in force.

## Random state

`Rnd` now uses a per-runtime 24-bit generator with the initial seed `0x50000`, Single conversion of its optional argument, negative-number reseeding, and non-advancing `Rnd(0)`. `Randomize` mixes the supplied Double's bits (or the local timer's Single bits when omitted), preserving the generator's low byte. Calling `Randomize` with the same number alone does **not** restart a sequence. For repeatable sequences, call `Rnd` with a negative number before `Randomize`.

The algorithm follows Microsoft's managed `VBMath` compatibility implementation. Tests include fixed vectors, 10,000 transitions checked using independent BigInt arithmetic, runtime isolation and a separate .NET `Microsoft.VisualBasic.VBMath` oracle. The latter is explicitly skipped when the SDK is unavailable; it is not a run of the original Microsoft VB6 compiler.

## Formatting and characters

`FormatNumber`, `FormatCurrency` and `FormatPercent` accept all five arguments: expression, fractional digits, leading digit, negative parentheses and grouping. Named and omitted arguments use the same signature metadata as ordinary compiled calls. `vbUseDefault`, the date-format constants and file-attribute constants are available to project code and IntelliSense. `FormatDateTime` rejects invalid style values instead of silently choosing a format. Automatic debugger inspection permits the pure formatting functions but still rejects stateful random/settings/file mutations.

Portable regional defaults are explicit: `en-US`, `USD`, two fractional digits, grouping and leading zeros, and parentheses for negative Currency values. An embedding host may supply `numberFormat` with `locale`, `currency`, `numberDigits`, `currencyDigits`, `percentDigits`, `leadingDigit`, `negativeParentheses` and `groupDigits`. This does not read Windows regional settings. Formatter caching is bounded to 32 entries per library. Currency and Decimal values are passed to `Intl.NumberFormat` as exact decimal strings, avoiding a lossy Double intermediary in their printed digits. Regional patterns and rounding still depend on the JavaScript engine's Intl implementation and are not an exhaustive native-VB6 formatting certification. The separate general-purpose `Format` pattern engine is unchanged and remains partial.

`Chr` and `Asc` use Windows-1252, including the extended 0x80–0x9f mapping. `ChrW` validates and rounds its input; `AscW` returns a signed UTF-16 code unit. `String` handles Null propagation and numeric character codes modulo 256. Explicit dollar aliases retain their non-Null String contract.

`StrConv` supports case modes 0–3, supported explicit LCIDs, locale-aware upper/lower case and proper-case word separators as documented by Microsoft. Portable LCID 0 means en-US. Unsupported LCIDs, Unicode/ANSI byte-string conversion, width and kana modes raise error 5 instead of silently returning unchanged text. This is **not** a complete `StrConv` implementation. Odd-byte BSTRs, `ChrB`/`AscB` and unrestricted DBCS/code-page conversion still require additional representation and codec work.

## Project settings

`GetAllSettings` returns an independent, zero-based two-dimensional String array of key/value pairs, or Empty when the section is absent. Save, lookup, enumeration and deletion share case-insensitive component matching and the existing host persistence hook. Empty/NUL-containing names and missing deletion targets are diagnosed.

These are private project settings, **not** the Windows registry. Existing `app/section/key` snapshots, including literal percent characters, remain readable. Names containing a slash use a distinct encoded key representation; old keys are not reinterpreted as URI escapes. Internal dictionary updates do not traverse inherited JavaScript properties.

## Private filesystem

The runtime now provides `FileDateTime`, `GetAttr`, `SetAttr`, `FileAttr(..., 1)`, attribute-aware `Dir`, strict `ChDir`/`MkDir`/`RmDir` and top-level wildcard `Kill`. `FileAttr` returns the documented open-mode mask. Native OS handle retrieval via `FileAttr(..., 2)` is unavailable and raises error 5.

`Dir` enumeration belongs to its VM, never crosses a directory boundary, includes extensionless files for `*.*`, filters hidden/system files and includes folders only when requested. The end of enumeration returns an empty string once; another argumentless call raises error 5 until a new pattern is supplied. Wildcard deletion validates every matched file before deleting any, preventing partial deletion when a file is locked or read-only.

Filename matching treats regex/Like metacharacters such as brackets and `#` literally, collapses repeated stars, and does not use a backtracking regular expression. Patterns are capped at 4,096 UTF-16 units, with a shared 10,000,000-step matching/normalization budget per enumeration; exceeding a limit raises error 7. These are explicit portable resource limits, not Windows filesystem limits. A failed `Dir` pattern does not replace an existing enumeration; a failed wildcard `Kill` leaves every file unchanged.

Paths have case-insensitive fallback resolution while preserving stored names. Opening a file requires its parent folder to exist. Low-level host imports can infer missing directories for compatibility with older snapshots. Snapshot version 3 persists file attributes and modification times and still reads old text/byte snapshots. Timestamp values are virtual-disk metadata, not host filesystem timestamps.

Concurrent append handles refresh current content and append at the current end rather than overwriting another handle's newer writes. Sequential writes honor seeks, overwrite only their span and pad gaps. Access, sharing and range-lock checks precede mutation. `Line Input #` consumes CR or CRLF; a lone LF remains data. The existing binary codecs and their explicitly unsupported native layouts are unchanged. Browser file-size limits, no OS/device mapping, no cross-tab coordination and no native OS lock guarantees still apply.

## FileSystemObject and TextStream

The private `Scripting.FileSystemObject` adapter exposes live File descriptors, Folder descriptors, file/subfolder collections, path helpers and validated create/copy/move/delete operations. File descriptors support attributes, last-modified time, renaming and opening a text stream. Collections support the existing `Collection` indexing and `For Each` behavior. Adapter methods carry named-argument metadata.

Text streams support Read, ReadLine, ReadAll, Skip, SkipLine, Write, optional WriteLine, WriteBlankLines, Line, Column, AtEndOfLine and AtEndOfStream. Stream cursor accounting handles CR, LF and CRLF. Closed streams and wrong-mode accesses produce runtime errors. Each TextStream owns a specific handle instance: after its own Close, VB Close, or Reset, every stream operation rejects with error 52 even when the numeric file slot is reused. Stale streams cannot read, write or close the replacement file. Boolean create, overwrite, Unicode and force arguments are validated before filesystem mutation, including on paths that already exist. Destructive opens validate unsupported encoding/mode arguments before creating or truncating a file.

Only the existing Windows-1252 stream codec is implemented. `CreateTextFile(..., unicode:=True)` and Unicode `OpenTextFile` format requests fail explicitly; they do not create a misleading ANSI file. General FSO wildcard copy/move/delete, recursive folder operations, native drive objects and arbitrary COM identity/lifetime parity remain incomplete.

## Validation

Focused tests are `runtime-intrinsics.test.mjs`, `character-library.test.mjs`, `filesystem-intrinsics.test.mjs`, `text-stream-lifetime.test.mjs`, `file-pattern.test.mjs` and `runtime-random-reference.test.mjs`. The managed reference is SDK-dependent. File-pattern tests compare deterministic generated cases to an independent dynamic-programming matcher and exercise adversarial inputs with a finite work budget. Browser cases exercise compiled/exported intrinsics, settings, named file calls, stale-stream ownership, filename patterns and invalid Boolean flags.

Run the Node suites using the repository's CI sharding, build with `npm run build`, and run `python tools/browser-compiler-runtime.py` for inline browser coverage or `python tools/browser-compiler-runtime.py --http` for actual HTTP navigation. Regenerate `tools/ide-artifacts.json` with the documented local `npm run build:update-ide-artifacts` command after intentional compiler/runtime changes; do not bypass its check in CI.

Pull-request CI artifacts retain revision-specific results. Inspect the Node shards, independent managed-reference result, generated fingerprint verification and HTTP browser checks before merging. Inline browser execution is not HTTP-launch certification, and an SDK-dependent skip is not an independent managed-reference pass.

## Primary references

These references informed individual rules; their use does not establish full VB6 equivalence.

- [Rnd](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/rnd-function)
- [VBMath implementation](https://github.com/dotnet/runtime/blob/main/src/libraries/Microsoft.VisualBasic.Core/src/Microsoft/VisualBasic/VBMath.vb) and [ProjectData initial state](https://github.com/dotnet/runtime/blob/main/src/libraries/Microsoft.VisualBasic.Core/src/Microsoft/VisualBasic/CompilerServices/ProjectData.vb)
- [FormatNumber](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/formatnumber-function) and [FormatCurrency](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/formatcurrency-function)
- [StrConv](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/strconv-function), [Chr](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/chr-function) and [String](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/string-function)
- [GetAllSettings](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/getallsettings-function) and [DeleteSetting](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/deletesetting-statement)
- [Dir](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/dir-function), [FileAttr](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/fileattr-function) and [Line Input](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/line-inputstatement)
