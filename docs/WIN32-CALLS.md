# Native procedure call arguments

The direct JavaScript-written PE32/x86 compiler supports early-bound named
arguments, typed Optional parameters, and caller-owned scalar ByRef value
copies. These use the same compiler in Node, the classic File > Make EXE command,
the standalone HTML IDE and the DOM-free Web Worker SDK. They do not require a
new IDE interface or an embedded JavaScript/VB6 execution engine.

## Typed Optional arguments

Sub and Function parameters can be declared Optional with Byte, Integer, Long,
Boolean, Single, Double, Currency, Date, String or Variant. Both ByVal and ByRef forms are
supported. A constant default is bound in the **declaring module**, not the
caller's scope, and checked for the declared type before machine code is emitted.
An omitted scalar without an explicit default receives zero, False or an empty
String. Each omitted ByRef argument gets its own writable caller-frame variable;
changes to it do not persist into the next call. Recursion has independent frames.

```vb
Private Const DefaultRate As Currency = 1.125@

Public Function Price(ByVal count As Long, _
                      Optional ByVal rate As Currency = DefaultRate, _
                      Optional ByRef note As String = "standard") As Currency
    note = "computed"
    Price = count * rate
End Function

Public Sub Main()
    Dim answer As Currency, text As String
    answer = Price(2)                       ' 2.25; omitted note is a private copy
    answer = Price(count:=3, note:=text)    ' actual text receives "computed"
End Sub
```

Empty positional slots and trailing omitted parameters are supported. Names are
case-insensitive and parameter type suffixes are removed when matching names to
parameter declarations. Explicit type conversions remain subject to the existing
native numeric rules. In particular, use CLng/CInt/CBool explicitly where the
native numeric backend requires conversion from String text.

An unsupported default expression, out-of-range default or unsupported type is
a compile diagnostic. Call-specific default errors identify the declaration's
module and line. The compiler does not evaluate user procedures or variables to
obtain a default. An Optional Variant without an explicit default receives the
Missing VT_ERROR value and can be tested with IsMissing; a supplied Empty or Null
is not Missing. Optional objects/arrays remain unsupported. Project ParamArray
and its ownership/positional-call contract are documented in
[Native Variants and ParamArray](WIN32-VARIANTS.md). Startup Main and native event
handlers retain their fixed signatures; they cannot gain Optional parameters.

## Named argument evaluation and layout

The entire argument list is validated before its argument code is emitted.
Unknown names, duplicate bindings, too many arguments, missing mandatory values,
and positional values after a named argument are diagnosed. An explicitly empty
positional slot already occupies that parameter; naming it later is a duplicate.

Supplied expressions evaluate once in written order. Values are staged in the
caller's frame and then pushed in formal-parameter order required by stdcall,
not in the order that named arguments appeared. Double/Currency ByVal slots are
eight bytes; ordinary supported scalar slots/references are four. Variant values
use pointer-based slots and Variant functions add a hidden caller-owned result
pointer; the value itself is 16 bytes. The compiler also bounds the full argument
area, including that hidden pointer, against the x86 RET immediate limit.

This applies to project Sub/Function procedures and supported early-bound Declare
signatures. It does not add named-argument metadata to every built-in function,
late-bound COM call, unsupported control method or Property procedure.

## ByRef variables versus values

An unparenthesized addressable scalar variable requires the exact declared
ByRef type, except that ByRef As Variant accepts supported typed scalar l-values
through borrowed VT_BYREF descriptors. Those descriptors preserve immediate alias
updates and the referent's declared width; see [the Variant ABI](WIN32-VARIANTS.md).
Array elements retain a backing-store
pin through the call, and failure during a later argument releases earlier pins
before recovery continues.

A scalar expression, a supported intrinsic control property, or an explicitly
grouped argument is converted into its own writable typed temporary. Changes to
that temporary do **not** copy back. Use an extra pair of parentheses inside an
explicit Call argument list to request a value copy unambiguously:

```vb
Private Sub Adjust(ByRef number As Integer)
    number = number + 1
End Sub

Private Sub Example()
    Dim original As Double
    original = 2.5
    Call Adjust((original))  ' Integer copy starts at 2; original remains 2.5.
    Call Adjust(1 + 2)       ' Writable temporary, not a pointer into constant data.
End Sub
```

These examples rely on groups retained by the shared expression parser. This
extension does not redefine the shared parser's acceptance/normalization of every
legacy bare-Sub parenthesis spelling. Calls that require a value copy should use
the explicit syntax above; full VB6 call-syntax conformance is not certified.

String references get zero-initialized owned BSTR slots. The callee may replace
the BSTR; the caller releases the resulting allocation after the call, or during
error cleanup if argument evaluation or the callee fails. String function results
are retained independently before these temporary references are destroyed.
Fixed-length scalar Strings and inline UDT String fields now use an owned
variable-length bridge for project `ByRef As String` and `ByRef As Variant`
parameters. The original address is captured once, including indexed fields;
SAFEARRAY element storage stays pinned until the call completes. On normal return,
copy-back pads/truncates through the original fixed-width assignment path. Multiple
fixed arguments have separate snapshots and commit in source evaluation order.
A propagated error or failed later argument discards the bridge; grouped values
never copy back. A Variant formal retains String coercion through a borrowed
VT_BYREF | VT_BSTR view of the bridge, so assigning Null still raises error 94.
String function returns become owned before any allocating copy-back begins.

This adaptation is distinct from variable-length scalar ByRef aliases, whose
writes remain immediate. Whole fixed-String arrays and parenthesized whole-array
values are not passed through this scalar adapter. A value boxed into a supported
Variant parameter is instead an independently owned snapshot. The Windows call
matrix executes both maintained fixture families at O0/O1/O2.

## Explicit native pointer/value overrides

For a supported external scalar Long parameter declared ByRef, call-site `ByVal`
sends the Long value directly rather than the address of a local variable:

```vb
Private Declare Function GetCurrentProcess Lib "kernel32" () As Long
Private Declare Function GetProcessId Lib "kernel32" (ByRef process As Long) As Long

Private Sub Example()
    Dim id As Long
    id = GetProcessId(ByVal GetCurrentProcess())
End Sub
```

The numeric override is limited to an external **ByRef Long** declaration.
The external ByRef String override is implemented separately under
[the ANSI byte-BSTR marshalling contract](WIN32-STRING-INTEROP.md). Neither is
a general reinterpret-cast for Currency, Double, arrays, records,
callbacks or project procedures. For project ByRef value copies, use parentheses.
As with all native Declare calls, the author's signature must match the real API;
incorrect native pointers/calling conventions are not sandboxed or repaired.

## Validation

`tests/win32-calls.test.mjs` checks argument planning, supported declaration types,
constant binding, diagnostics, immutability, callback guards, return-stack bounds
and deterministic executable construction. The fixtures emitted by
`tools/win32-call-fixtures.mjs` contain numbered assertions for the eventual real
Windows execution job: AotCalls covers numeric/String defaults, calls, pins and
errors; AotCallProperties exercises actual control properties and Form_Load.

```sh
npm run build
node --test tests/win32-calls.test.mjs
node tools/win32-call-fixtures.mjs
```

On Windows, execute the newly emitted artifacts with:

```powershell
./tools/test-win32-calls.ps1
```

The test harness runs each EXE alone in a fresh directory, checks its exit code
against its manifest, detects unexpected adjacent extracted files, captures
runtime-error dialog text on timeout and writes reports on success or failure.
The PowerShell/C# probe is test-only, not compiled into the shipped EXE or SDK.
A successful JavaScript test or browser download is **not** a Windows execution
pass. Native execution of these new fixtures is a required validation gate before
merging. The existing read-only `.github/workflows/validate.yml` native-compiler job
runs the integrated runtime and control matrices. The standalone call fixture
commands above remain useful for focused Windows investigation.

## Primary language references

- Argument lists and call-site ByVal: https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/5b35d806-1305-4427-a120-d25a71c45c02
- Procedure invocation argument processing: https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/1fb9af32-fc48-4c4f-998a-ed8047048ca5
- Parameter lists and omitted parameters: https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/78bcb344-4966-4401-bb55-72729790ebee
- ByRef mismatch and explicit grouping: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/byref-argument-type-mismatch

This remains the direct native-controls/GDI target. It does not add WebGPU,
arbitrary classes/COM/OCX, full native
callback/structure interoperability, or licensed Microsoft compiler certification.
Native scalar Variants, Decimal subtypes, typed and Variant-contained arrays,
nested array values and project ParamArray are implemented under [their separate contract](WIN32-VARIANTS.md).
