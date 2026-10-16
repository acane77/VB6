# Native Variant values, references and ParamArray

The direct PE32/x86 target supports native Automation Variant values. This is a
bounded language/runtime implementation, not a claim of complete VB6, COM or
OCX compatibility. The compiler emits x86 code and imports Windows OleAut32 APIs;
it does not embed the browser VM or extract a JavaScript runtime.

## Values and storage

A scalar Variant occupies 16 bytes on this target. Its tag is a 16-bit VARTYPE at
offset 0; ordinary scalar payloads start at offset 8. VT_DECIMAL overlays the
complete 16-byte value rather than pointing to a separate Decimal allocation.
Uninitialized Variant storage starts as Empty. Supported values include Null,
Byte, Integer, Long, Boolean, Single, Double, Currency, Date, counted Unicode
String, Error and Decimal subtypes. Decimal is produced by `CDec`; this does not
introduce a separately declared `As Decimal` storage type. Scalar text coercion
uses the installed Windows user locale. The numeric Decimal examples below avoid
locale-dependent decimal text; binary String/String comparison remains ordinal.

`CVar`, `CVErr`, `CDec`, scalar conversion builtins, `VarType`, `TypeName`,
`IsEmpty`, `IsNull`, `IsError`, `IsMissing`, `IsNumeric`, `IsDate`, `IsArray` and
`IsObject` have native lowering within the supported value domain. Predicate
availability does not imply that Object/IDispatch values can be constructed or
stored. User procedures that shadow a builtin retain normal procedure resolution.

Variant arithmetic, comparisons, concatenation and logical operations use the
native tagged values. A Null condition is false in a conditional statement;
coercing Null to a scalar instead raises error 94. Implicit Error-to-scalar
assignment raises error 13. Explicit supported numeric Error conversions use the
SCODE, while `CStr(CVErr(n))` produces `"Error " & CStr(n)`. An omitted optional
Variant is represented by VT_ERROR / DISP_E_PARAMNOTFOUND (`&H80020004`), not by
Empty, Null or the small error codes accepted by CVErr. Using it as an ordinary
scalar raises error 449.

### Complete scalar/reference example

```vb
Option Explicit

Private Sub WriteThrough(ByRef target As Variant)
    target = CInt(12)
End Sub

Private Function ValueOrDefault(Optional value As Variant) As Variant
    If IsMissing(value) Then
        ValueOrDefault = CDec(1.25#)
    Else
        ValueOrDefault = value
    End If
End Function

Public Sub Main()
    Dim count As Integer
    Dim value As Variant
    Dim items() As Variant
    Dim snapshot() As Variant

    count = 7
    WriteThrough count
    If count <> 12 Then Error 5

    value = ValueOrDefault()
    If VarType(value) <> 14 Then Error 5
    ReDim items(-1 To 1)
    items(-1) = value
    items(0) = "A" & ChrW(0) & "B"
    items(1) = Null
    snapshot = items
    Erase items
    If snapshot(-1) <> CDec(1.25#) Then Error 5
    If Len(CStr(snapshot(0))) <> 3 Then Error 5
    If Not IsNull(snapshot(1)) Then Error 5
End Sub
```

## Ownership and procedure ABI

Expressions snapshot values before later operands can modify them. Copying uses
`VariantCopyInd` into a separate owned temporary; reference descriptors therefore
do not accidentally escape as the result of a value expression. Writes publish
a completed temporary only after fallible conversion/copy steps succeed. Failed
operations preserve the old destination and release any partial result. String
values retain BSTR lengths, including embedded NULs. Global/form lifecycle and
local normal/error-unwind cleanup include the new Variant owners.

A project ByVal Variant parameter is passed as a pointer to a caller snapshot;
the callee creates an independently owned local value. A ByRef Variant parameter
receives a pointer to the original Variant or to a borrowed typed reference
descriptor. A Variant-returning project function uses a four-byte hidden result
pointer to caller-owned 16-byte storage. It does **not** return a pointer to a
callee stack local. The hidden result participates in the checked stdcall
argument-byte limit. These are internal project-call conventions, not a promise
of external Declare, vtable or IDispatch ABI compatibility.

### Typed ByRef aliases

Passing an unparenthesized Byte, Integer, Boolean, Long, Single, Double, Currency,
Date or variable-length String l-value to `ByRef value As Variant` creates a
borrowed `VT_BYREF | scalar-tag` descriptor. Assignment coerces to the original
referent type before updating that actual storage. Writes occur immediately, not
as deferred copy-back, so forwarding, repeated aliases and later errors observe
the same referent. Byte and word writes preserve adjacent storage; Single and
Double/Currency/Date retain their four/eight-byte representations. BSTR replacement
transfers ownership only after conversion succeeds.

Array element l-values stay pinned through later argument evaluation and the
callee. Resize/erase while pinned raises the existing error 10. Explicit grouping,
as in `Call WriteThrough((count))`, instead creates an isolated value temporary.
Fixed-length scalar Strings and inline UDT String fields use a writable owned
String bridge instead of an immediate alias, then pad/truncate on normal-return
copy-back. Grouped values never copy back, and failed calls discard their bridge;
see [native call arguments](WIN32-CALLS.md). Native reference descriptor chains
are bounded, but arbitrary memory supplied by raw Declare calls is not sandboxed.

## Typed Variant arrays and arrays inside scalar Variants

`Dim values() As Variant` and fixed Variant arrays are typed SAFEARRAYs whose
individual elements occupy 16 bytes. Copy, ReDim/Preserve, Erase, element aliases
and cleanup retain each element's ownership. A scalar Variant can separately own
an entire supported typed array: `value = values` makes an independent value copy,
including the source bounds and element type. Nested arrays retain their own
owners. Fixed-length String and user-defined record arrays cannot be boxed.

`Array(...)` constructs a Variant array using the calling module's Option Base;
`VBA.Array(...)` uses lower bound 0. Empty constructors create zero elements.
Positional omissions retain Missing values. User-defined Array procedures and
variables, or an actual VBA module, retain normal resolution precedence.

Indexed access to a Variant-contained array checks rank, bounds, VARTYPE and
actual element width before using a locked descriptor. Typed elements expose
exact-width borrowed reference views, not delayed copy-back. Nested elements
keep dependent descriptor pins alive across argument evaluation and calls.
Variant-returning functions can return owned arrays, and their results can be
indexed immediately without returning an unowned callee-stack pointer.

A compatible dynamic typed array can receive a value from a boxed array. The
element type must match; this is not an element-wise conversion between unrelated
array types. Failed conversion, allocation or locked-array replacement preserves
the previous destination. ReDim/Preserve and Erase on array-valued Variant
variables use their owned descriptor slots. ReDim on an initially Empty Variant
creates an array; the existing checked rank, bounds and backing budgets apply.

```vb
Option Explicit
Option Base 1

Private Function MakeValues() As Variant
    Dim items(1 To 2) As Long
    items(1) = 42
    items(2) = 7
    MakeValues = items
End Function

Public Sub Main()
    Dim value As Variant
    Dim copied() As Long

    value = MakeValues()
    copied = value
    value(1) = 9
    If copied(1) <> 42 Or value(1) <> 9 Then Error 5
    If MakeValues()(2) <> 7 Then Error 5

    value = Array(10, 20)
    If LBound(value) <> 1 Or UBound(value) <> 2 Then Error 5
    value = VBA.Array(Array(3, 4), Array(5, 6))
    If LBound(value) <> 0 Or value(0)(1) <> 3 Then Error 5
    value(0)(1) = 8
    If value(0)(1) <> 8 Then Error 5
End Sub
```

The `maxArrayBytes` option counts element backing storage, not separately owned
BSTR or nested-array allocations; it is not a cumulative memory quota. See
[native arrays](WIN32-ARRAYS.md). Passing a whole typed array as a borrowed scalar
`ByRef As Variant` remains diagnosed; boxing an independent value does not create
that alias. Object/IDispatch payloads and arbitrary Automation interoperability
remain outside this implementation.

## ParamArray

A project procedure may end with one unsized `ParamArray values() As Variant`.
Optional parameters in that signature, named arguments to the procedure and
external Declare ParamArray conventions are rejected. Required prefix parameters
stay required. Each extra actual argument is evaluated once in written order and
packed as an owned Variant value. Scalar changes inside the callee do not write
back to the original actual argument.

```vb
Option Explicit
Option Base 1

Private Function Total(ParamArray values() As Variant) As Variant
    Dim index As Long
    Dim result As Variant
    result = CDec(0)
    For index = LBound(values) To UBound(values)
        If Not IsMissing(values(index)) Then
            result = result + values(index)
        End If
    Next index
    Total = result
End Function

Public Sub Main()
    Dim answer As Variant
    answer = Total(1, , CDec(2.5#))
    If answer <> CDec(3.5#) Then Error 5
    answer = Total()
    If answer <> 0 Then Error 5
End Sub
```

An empty pack is an allocated zero-element SAFEARRAY with lower bound 0 and upper
bound -1, independently of Option Base. `IsMissing(values)` is always false;
omitted elements within a nonempty pack contain the Missing Error value and can
be tested individually. Empty is a distinct supplied value, not a missing slot.

The caller owns a `VT_ARRAY | VT_VARIANT` temporary, publishes its owner before
any extra actual is evaluated, and passes the address of its SAFEARRAY pointer
slot to the callee. `SafeArrayCreate` avoids imposing the fixed-size vector flag.
`SafeArrayPutElement` copies each supported value. A failure during packing or in
the callee releases the partial pack through statement/error cleanup. Recursion
creates independent owners. A ParamArray can be forwarded to an ordinary exact-
type `ByRef values() As Variant` procedure without creating an alias to the
original scalar actuals. Passing a supported whole array as one ParamArray
actual now boxes a nested value; this does not flatten the source array into
multiple actual arguments. Direct ReDim/Erase of the ParamArray parameter is a
language diagnostic. Whole-array replacement of that parameter is not yet
lowered; element assignments remain supported.

The pack's element storage is checked against `maxArrayBytes` before allocation.
This is not a cumulative allocation quota and does not bound separately allocated
BSTR contents. Unused programs do not import the ParamArray packing API merely
because the compiler implements it.

## Division error classification

The runtime calls the installed `VarDiv` first. Only arithmetic-error HRESULTs
are examined for zero-divisor correction; successful division and unrelated
errors are preserved. Temporary conversion to Double is for zero classification,
not quotient computation. The wrapper distinguishes nonzero/zero, ordinary 0/0,
effective Decimal and Empty combinations, including signed zero. Original
Windows assertion 31 remains a regression for the discovered nonzero/zero
HRESULT mismatch; it was not changed to accept the faulty result.

## Validation and remaining boundaries

Compiler/ABI tests are in `tests/win32-variants.test.mjs`,
`tests/win32-variant-kernels.test.mjs`, `tests/win32-variant-division.test.mjs`,
`tests/win32-variant-reference.test.mjs`, `tests/win32-paramarray-plan.test.mjs`,
`tests/win32-paramarray.test.mjs`, `tests/win32-variant-arrays.test.mjs` and
`tests/win32-variant-array-kernels.test.mjs`. Instruction-level tests use explicit mocked
OleAut32 APIs; they are not an independent Windows implementation or OS oracle.
`tests/win32-runtime-doc-examples.test.mjs` compiles every complete example on
this page at O0/O1/O2; it does not execute the generated PE32 files.

`tools/win32-variant-fixtures.mjs` retains the original groups and adds the
separate division, reference, ParamArray and Variant-array fixture modules.
The Variant family contains 214 assertion groups in every optimization variant;
all earlier 164 groups remain before the 50 Variant-array groups. The complete Windows
runtime matrix is emitted by `tools/win32-speed-size-fixtures.mjs` and executed
by `tools/test-win32-optimizer.ps1` in the existing Validate workflow. Actual
execution evidence must match the source commit and the executable SHA-256s.
Do not treat local Node success as Windows acceptance.

Object/IDispatch storage, general classes/interfaces, native provider/OLE hosting,
whole typed-array borrowing as a scalar ByRef Variant, arbitrary late binding,
whole fixed-String arrays and remaining advanced framework members are unfinished.
Scalar fixed-length Strings and inline UDT String fields support normal-return
ByRef String/Variant copy-back under [the native call contract](WIN32-CALLS.md).
This page records the implemented contract, not universal native VB6 parity.

## Primary references

- [VARIANT layout](https://learn.microsoft.com/en-us/windows/win32/api/oaidl/ns-oaidl-variant).
- [VariantCopyInd and reference dereferencing](https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-variantcopyind).
- [IsMissing and empty ParamArray detection](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/ismissing-function).
- [MS-VBAL procedure argument processing](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/1fb9af32-fc48-4c4f-998a-ed8047048ca5).
- [MS-VBAL division semantics](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/8628f21c-3f02-42b1-908c-201bd7ffe1b5).
