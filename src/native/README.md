# Direct native compiler

`compiler.js` exports `compileWin32(project, options)`: a JavaScript compiler and
linker that produces freestanding x86 PE32 executables. Generated code calls real
Windows APIs. It does not embed the browser VM, extract an application host, or
execute an EXE inside the browser.

The implementation is modular: language lowering, owned scalar/array/record
storage, private native services, x86 instruction encoding and optimization, PE
linking, Win32 controls, forms and event dispatch have separate modules.

## Contracts

- [Build, SDK and target boundaries](../../docs/WIN32-AOT.md)
- [Sequential files, input and output](../../docs/WIN32-SEQUENTIAL-IO.md)
- [Native call ABI](../../docs/WIN32-CALLS.md)
- [Private compiler-owned services](../../docs/WIN32-PRIVATE-SERVICES.md)
- [Optimization and linked-code contracts](../../docs/native-compiler-optimization.md)

## Validation

Run `npm run build`, `npm run test:native` and `npm run test:win32` from the
repository root. The native Windows CI job also compiles self-checking EXEs at
O0/O1/O2 and executes their real HWND, file, Automation and GDI operations. Its
hash-checked execution reports are distinct from portable emitted-code ABI tests.

## Scope

This is not complete Microsoft VB6 compiler/runtime parity. Binary/Random file
records, InputB, file locking statements, unrestricted COM/OCX hosting, additional
control members, whole fixed-String arrays and other whole-array call shapes, record
arrays and several independent-form features still have explicit boundaries.
Do not remove a diagnostic merely to make an unsupported application compile;
add lowering, ownership/error behavior and executable regressions together.
