# Native sequential file I/O

These services compile to ordinary x86 and real synchronous Win32 file handles.
They do not use the browser virtual filesystem or a JavaScript interpreter.

## Supported operations

`Open ... For Input`, `Output` and `Append`, explicit compatible Access/Shared/Lock
open modifiers, file numbers 1–511, `FreeFile(0/1)`, `Close`, `Print #`, `Write #`,
`Line Input #`, `Input #`, `Input$`, `EOF`, `LOF`, `Loc`, `Seek` as a query or
statement, and `FileAttr(number, 1)` use the same native file table.

Input opens an existing file with read access; a missing path is never created.
Output checks live file identity before truncation. Append seeks to the existing
end and uses append-only writes. File names are Unicode; sequential contents use
the installed Windows ANSI code page. Open's sequential buffer length is checked
in 1–32,767 bytes. Read buffers are allocated lazily and freed by Close.

Read-ahead does not advance the public cursor. Seek returns the next one-based
byte position; Loc returns complete 128-byte sequential units; LOF uses the real
file size. Seek invalidates unread bytes, character-decoder carry and print-column
state. The 64-bit Windows file APIs explicitly diagnose positions/sizes outside
VB Long rather than truncating them.

`Input$(count, #number)` accepts the optional file-number hash, including named
arguments. It returns counted UTF-16, retaining NUL, punctuation and line endings.
The decoder handles multibyte sequences split across buffer fills. `Line Input #`
ends at CR or CRLF, retains an isolated LF and returns a final nonterminated line.
A read started at EOF or a short fixed-count read raises error 62.

`Input #` supports scalar String, Variant, Byte, Integer, Long, Single, Double,
Currency, Date and Boolean destinations, including array elements and supported
UDT fields. Fixed Strings use normal padding/truncation. Quoted strings, empty
fields and Null/Boolean/Error/date markers retain their specified meanings.
Numbers use a fixed locale; typed Currency input does not pass through Double.
Fields are committed in source order: a later conversion failure preserves prior
successful assignments and the old value of the failed destination.

`Write #` stages independently owned field snapshots before touching the file.
Its invariant numbers, universal dates and Variant markers are interchange data,
not localized Print display text. A size-once/copy-once builder allocates the final
record once; it does not repeatedly concatenate a growing record. Embedded quotes
are not RFC 4180 escaping: the Input reader treats adjacent quoted fields as
separate items. Use ordinary Strings without embedded quotation marks for reliable
Write/Input record round trips.

Generation checks prevent a staged write, Seek position expression or input
subscript from silently redirecting an operation to a closed-and-reused handle.
An OS write failure can still leave partially written bytes; this is synchronous
file I/O, not a transactional filesystem or atomic replacement service.

## Example

```vb
Option Explicit
Public Sub Main()
 Dim file As Integer, label As String, quantity As Long, cost As Currency
 file=FreeFile
 Open "items.txt" For Output As #file
 Write #file,"Widgets",3,CCur(12.3456)
 Close #file
 Open "items.txt" For Input As #file Len=128
 Input #file,label,quantity,cost
 If label<>"Widgets" Or quantity<>3 Or cost<>CCur(12.3456) Then Error 5
 If Not EOF(file) Then Error 5
 Close #file
End Sub
```

## Validation and remaining boundaries

`tests/win32-file-*.test.mjs` checks deterministic PE generation and emitted
helpers with bounded memory and explicit foreign-API doubles. These portable
checks are not represented as Windows execution. `tools/win32-file-*-fixture.mjs`
provides self-checking real Windows EXEs, including independent Win32 byte writers
and readers, error recovery, input targets and handle ownership at O0/O1/O2.

The String/record bound remains 1,048,576 UTF-16 units. FileAttr's obsolete 16-bit
handle return mode is rejected. Binary/Random Open, Get/Put record serialization,
InputB, Lock/Unlock statements, asynchronous I/O and arbitrary file-service
intrinsics are not added by this work. Cross-code-page ABI tests do not certify
all Windows locales, legacy Ctrl-Z EOF behavior or exact proprietary VB6 behavior
for malformed multibyte input. See the broader [AOT contract](WIN32-AOT.md).

References: Microsoft's [Input statement](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/f41b8636-a3f5-4501-b1a9-78058017c232),
[Input function](https://learn.microsoft.com/office/vba/language/reference/user-interface-help/input-function),
[Line Input](https://learn.microsoft.com/office/vba/language/reference/user-interface-help/line-inputstatement),
[Write statement](https://learn.microsoft.com/office/vba/language/reference/user-interface-help/writestatement),
[ReadFile](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-readfile) and
[SetFilePointerEx](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-setfilepointerex).
