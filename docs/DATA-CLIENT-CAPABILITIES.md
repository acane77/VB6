# Portable data-client capabilities

This document describes `src/data`, not complete native Microsoft ADO, Jet/ACE
DAO, OLE DB, ODBC or RDO compatibility. See [Data sources](DATA-SOURCES.md) for
provider configuration, gateways, the Data Environment and application examples.

## Ownership and cancellation

`DataContext` owns connections while they are opening as well as when they are
open. Closing invalidates pending results, waits for provider acquisition to
settle, and disposes the adapter once. Reentrant or repeated connection `Close`
calls share the same promise. A throwing cancellation hook does not skip cleanup.
The original query/open error is preserved when cleanup also fails; JavaScript
callers can inspect `error.cleanupError`.

Passing a connection string to a command or recordset creates an internally owned
connection. An open result takes ownership; its surviving clones keep that
connection alive until the last owner closes. This also covers detached client
snapshots. Closing an old detached snapshot must not close a newly reopened
provider session. A failed open, invalid provider result or action-only command
does not leak the internal connection.

VB calls await I/O. Cancellation rejects stale responses even when a transport
ignores cancellation, but cannot promise rollback of a remote write that already
committed. Native asynchronous event timing and exactly-once write semantics are
not emulated.

## Client features

The portable implementation includes input-parameter ADO commands, materialized
read-only/immediate optimistic/batch optimistic cursors, independent clone
positions and views, shared batch state, typed fields, stable bookmarks, pages,
filters, sorting, `Find`, `GetRows`, `GetString`, `UpdateBatch`, `CancelBatch` and
provider-backed refresh. Joins, unkeyed results and services without configured
writes do not become writable merely by changing `LockType`.

`Recordset.Open` accepts SQL/resource text or a genuine `ADODB.Command` registered
in the same context. The command supplies its own connection, typed parameters
and request options. A second ActiveConnection argument is rejected. Commands
snapshot inputs before opening an owned connection and reject overlapping
execution on the same command object.

```vb
Dim cn As New ADODB.Connection, cmd As New ADODB.Command
Dim rs As New ADODB.Recordset
cn.Open "Local"
Set cmd.ActiveConnection = cn
cmd.CommandText = "SELECT name FROM customers WHERE id = ?"
cmd.Parameters.Append cmd.CreateParameter("id", adInteger, adParamInput, 0, 2)
rs.Open cmd
If Not rs.EOF Then Debug.Print rs.Fields("name").Value
rs.Close
cn.Close
```

DAO retains explicit Edit/AddNew copy buffers, typed QueryDefs and SQLite catalog
objects. RDO retains its ODBC-numbered parameter types, explicit edit buffers and
client-batch collision handling. These wrappers are not aliases for ADO and do
not claim native Jet/ACE file support.

## Criteria, bookmarks and field integrity

The ADO criteria parser is non-evaluating and distinct from the DAO parser. `AND`
and `OR` are evaluated left to right with equal precedence. Parentheses support
ORs of AND-groups. As in the documented ADO contract, AND-ing an explicitly
OR-grouped clause is rejected rather than silently applying SQL precedence.

```vb
rs.Filter = "(id=1 AND total>0) OR (id=2 AND total>10)"
' Invalid ADO grouping: (id=1 OR id=2) AND total>0
```

Malformed filters and invalid movement/row-retrieval arguments are checked before
committing pending edits. Backward Find skips in the backward direction and
reaches BOF on a miss. `CompareBookmarks` compares acquisition order within the
cursor/clone domain, independently of the current Sort/Filter; it does not coerce
strings into numeric bookmarks. Bookmark filters copy their input arrays.

Repeated `Fields.Item` calls return the same field object. Closed schemas support
Append/Delete. Requery or schema replacement invalidates obsolete field objects.
Field definitions retain Type, DefinedSize, Attributes, Precision and NumericScale;
metadata is not a promise that SQLite enforces native fixed-point storage rules.

Date and binary values returned through field reads or GetRows are independent
copies. JavaScript callers retain Uint8Array. The source VM converts registered
ADO/DAO/RDO binary results to VB Byte() arrays, including nested GetRows cells.
The conversion is iterative, bounded, and is not granted by a forged `__type`.

ADO GetChunk progresses across repeated lookups of the same field. Access to a
different field, including through a clone, resets chunk sequencing. The first
AppendChunk overwrites; subsequent calls in the same sequence append. Navigation,
update, cancellation and view changes reset the sequence. DAO/RDO keep their
explicit-buffer chunk conventions. Indexed receiver statements such as
`rs.Fields("memo").AppendChunk "text"` preserve VB's existing no-Call argument
and ByRef grouping rules.

## SQLite schema discovery

OpenSchema supports the following kinds and ordered restrictions. Supply a
one-dimensional JS/VB array; Empty/Null slots are unrestricted. Populated strings
match case-insensitively and exactly, not as wildcard expressions.

| Constant | Value | Restrictions |
| --- | ---: | --- |
| adSchemaCatalogs | 1 | catalog |
| adSchemaColumns | 4 | catalog, schema, table, column |
| adSchemaIndexes | 12 | catalog, schema, index, type, table |
| adSchemaSchemata | 17 | catalog, schema, owner |
| adSchemaTables | 20 | catalog, schema, table, table type |
| adSchemaViews | 23 | catalog, schema, view |
| adSchemaForeignKeys | 27 | PK catalog/schema/table, FK catalog/schema/table |
| adSchemaPrimaryKeys | 28 | catalog, schema, table |

```vb
Set rs = cn.OpenSchema(adSchemaColumns, Array(Empty, Empty, "customers", "name"))
Debug.Print rs.Fields("DATA_TYPE").Value
```

DATA_TYPE is numeric ADO metadata; TYPE_NAME preserves the SQLite declaration.
Columns include declared length/precision/scale, defaults, nullability, key order
and generated-column metadata. SQLITE_ROWID distinguishes rowid aliases from
nullable INT PRIMARY KEY and INTEGER PRIMARY KEY DESC columns. SQLITE_HIDDEN
retains the SQLite hidden/generated flag. Composite keys preserve ordinal order;
indexes expose uniqueness, descending order, expression slots and partial flags.
Foreign keys retain actions and SQLite constraint IDs; unavailable native names
stay Null rather than being invented. The catalog is main, with no fabricated
native schema or security ownership.

Schema identifiers are quoted and row/cell limits apply. Catalog reads and
comment-prefixed SELECT statements do not dirty or repeatedly serialize the
virtual SQLite database. DAO consumes TYPE_NAME to retain its own type mapping.
Other providers must expose the requested restriction columns or fail explicitly.

## Resource limits

Materialized results are limited to 100,000 rows, 1,024 columns and 1,000,000
cells. VB result marshalling also checks aggregate nested array elements. CSV and
long binary data have a 20 MiB ceiling; long text is bounded by UTF-16 storage.
CSV limits include UTF-8 bytes, quoted-output expansion and the final unterminated
row. SQL is limited to 1,000,000 characters and 100,000 tokens of every kind. ADO
criteria allow 16,384 characters, 128 comparisons and 64 nested groups. Schema
restriction strings allow 4,096 characters each.

CSV formula-looking strings remain literal data here; the writer does not claim
to neutralize formula interpretation by external spreadsheet applications.

## Remaining native-provider boundaries

Native server/keyset/dynamic/pessimistic cursors, native event timing and dynamic
Properties collections, arbitrary stored-procedure output/return parameters,
multiple native result streams, XML/ADTG recordset persistence, every OLE DB
schema/security rowset and distributed transactions remain outside this portable
increment. So do Jet/ACE binary engines, linked/workgroup/replication catalogs,
complete Jet SQL, native validation expressions and full ANSI/collation and
provider-specific numeric/date storage parity. Unsupported capabilities require
an explicit provider implementation rather than a silent semantic downgrade.

## Validation

```sh
node --test tests/data-*.test.mjs
npm run build
python tools/browser-data-sources.py
python tools/browser-data-recordsets.py --browser chromium
python tools/browser-data-layout.py
node tools/data-container-tests.mjs pg
node tools/data-container-tests.mjs mysql
node tools/data-container-tests.mjs mssql
```

The shared `tests/fixtures/data-client-completeness.bas` executes through both the
source VM tests and the built browser runtime. CI owns the data-source/layout
checks in core-runtime, and runs exported ADO/DAO/RDO recordsets under Chromium,
Firefox and WebKit. The fail-closed validation gate also requires all three live
database driver jobs. These require Docker and optional gateway drivers; they use
disposable loopback databases and generated per-run database credentials. Mocks
are not counted as live-driver passes. Exact installed driver versions are retained
in each driver report; these dependencies are not bundled into exported apps.

## Primary references

- [ADO Filter](https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/filter-property-ado)
- [ADO Find](https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/find-method-ado)
- [ADO CompareBookmarks](https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/comparebookmarks-method-ado)
- [ADO AppendChunk](https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/appendchunk-method-ado)
- [ADO GetChunk](https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/getchunk-method-ado)
- [ADO SchemaEnum](https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/schemaenum)
- [SQLite PRAGMA](https://sqlite.org/pragma.html)
- [SQLite CREATE TABLE](https://sqlite.org/lang_createtable.html)
