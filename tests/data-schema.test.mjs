import test from 'node:test';
import assert from 'node:assert/strict';
import {DataContext} from '../src/data/context.js';
import {VBArray} from '../src/runtime/values.js';
import {schemaRestrictions,restrictSchema} from '../src/data/schema.js';
const code=n=>error=>error.number===n;
async function fixture(t){
  const ctx=new DataContext(),cn=ctx.connection();await cn.Open('Provider=SQLite;Data Source=:memory:');t.after(()=>ctx.close());
  for(const sql of [
    'CREATE TABLE parent(a INTEGER NOT NULL,b VARCHAR(32),PRIMARY KEY(a,b))',
    'CREATE TABLE child(id INTEGER PRIMARY KEY,a INTEGER,b VARCHAR(32),amount DECIMAL_TEXT(18,4),raw BLOB,active BOOLEAN DEFAULT 1,FOREIGN KEY(a,b) REFERENCES parent(a,b) ON DELETE CASCADE ON UPDATE RESTRICT)',
    'CREATE UNIQUE INDEX ix_child ON child(b DESC,a ASC) WHERE active=1',
    'CREATE INDEX ix_expr ON child(length(b))',
    'CREATE VIEW child_names AS SELECT id,b FROM child',
    'CREATE TABLE "quo""te"("co""l" TEXT)',
    'CREATE TABLE implicit_ref(x INTEGER,y VARCHAR(32),FOREIGN KEY(x,y) REFERENCES parent)'
  ])await cn.Execute(sql);
  return {ctx,cn};
}
const rows=rs=>rs.view().map(row=>({...row}));
test('SQLite table discovery has catalog, table/view type and case-insensitive exact restrictions',async t=>{
  const {cn}=await fixture(t);const all=await cn.OpenSchema(20);assert.equal(all.RecordCount,5);
  assert.equal(all.Fields.Item('TABLE_TYPE').Type,202);assert(all.view().every(row=>row.TABLE_CATALOG==='main'));
  const one=await cn.OpenSchema(20,VBArray.from(['MAIN',undefined,'CHILD','TABLE']));assert.equal(one.RecordCount,1);assert.equal(one.Item('TABLE_NAME'),'child');
  assert.equal((await cn.OpenSchema(20,[undefined,undefined,'child%'])).RecordCount,0);
  assert.equal((await cn.OpenSchema(20,['other'])).RecordCount,0);assert.equal((await cn.OpenSchema(20,[undefined,'other'])).RecordCount,0);
  assert.equal((await cn.OpenSchema(20,[undefined,undefined,undefined,'VIEW'])).RecordCount,1);
});
test('column discovery preserves numeric ADO types plus original declaration, length, precision and defaults',async t=>{
  const {cn}=await fixture(t),rs=await cn.OpenSchema(4,[undefined,undefined,'child']);const byName=Object.fromEntries(rows(rs).map(row=>[row.COLUMN_NAME,row]));
  assert.equal(byName.b.DATA_TYPE,202);assert.equal(byName.b.TYPE_NAME,'VARCHAR(32)');assert.equal(byName.b.CHARACTER_MAXIMUM_LENGTH,32);
  assert.equal(byName.amount.DATA_TYPE,131);assert.equal(byName.amount.NUMERIC_PRECISION,18);assert.equal(byName.amount.NUMERIC_SCALE,4);
  assert.equal(byName.raw.DATA_TYPE,205);assert.equal(byName.active.DATA_TYPE,11);assert.equal(byName.active.COLUMN_HASDEFAULT,-1);assert.equal(byName.active.COLUMN_DEFAULT,'1');
  assert.equal(byName.id.PRIMARY_KEY,1);assert.equal(byName.id.ORDINAL_POSITION,1);
  const exact=await cn.OpenSchema(4,[undefined,undefined,'child','amount']);assert.equal(exact.RecordCount,1);
});
test('views expose their SELECT definition without CREATE VIEW wrapper',async t=>{
  const {cn}=await fixture(t),rs=await cn.OpenSchema(23,[undefined,undefined,'child_names']);assert.equal(rs.RecordCount,1);assert.equal(rs.Item('VIEW_DEFINITION'),'SELECT id,b FROM child');
});
test('primary keys preserve composite order and do not invent names for rowid aliases',async t=>{
  const {cn}=await fixture(t),parent=await cn.OpenSchema(28,[undefined,undefined,'parent']);assert.deepEqual(parent.view().map(row=>[row.COLUMN_NAME,row.ORDINAL]),[['a',1],['b',2]]);assert.equal(parent.Item('PK_NAME'),'sqlite_autoindex_parent_1');
  const child=await cn.OpenSchema(28,[undefined,undefined,'child']);assert.equal(child.Item('COLUMN_NAME'),'id');assert.equal(child.Item('PK_NAME'),null);
});
test('index schema includes key columns, unique/partial flags, descending order and expression identity',async t=>{
  const {cn}=await fixture(t),rs=await cn.OpenSchema(12,[undefined,undefined,'ix_child',3,'child']);assert.equal(rs.RecordCount,2);
  assert.deepEqual(rs.view().map(row=>[row.COLUMN_NAME,row.ORDINAL_POSITION,row.COLLATION,row.UNIQUE,row.PARTIAL]),[['b',1,2,-1,-1],['a',2,1,-1,-1]]);
  const expression=await cn.OpenSchema(12,[undefined,undefined,'ix_expr']);assert.equal(expression.RecordCount,1);assert.equal(expression.Item('COLUMN_NAME'),null);
  assert.equal((await cn.OpenSchema(12,[undefined,undefined,'ix_child',2])).RecordCount,0);
});
test('foreign key schema preserves composite order, referential actions and unnamed constraint IDs',async t=>{
  const {cn}=await fixture(t),rs=await cn.OpenSchema(27,[undefined,undefined,'parent',undefined,undefined,'child']);assert.equal(rs.RecordCount,2);
  assert.deepEqual(rs.view().map(row=>[row.PK_COLUMN_NAME,row.FK_COLUMN_NAME,row.ORDINAL]),[['a','a',1],['b','b',2]]);
  for(const row of rs.view()){assert.equal(row.DELETE_RULE,'CASCADE');assert.equal(row.UPDATE_RULE,'RESTRICT');assert.equal(row.FK_NAME,null);assert.equal(row.SQLITE_CONSTRAINT_ID,0);}
  const implicit=await cn.OpenSchema(27,[undefined,undefined,'parent',undefined,undefined,'implicit_ref']);assert.deepEqual(implicit.view().map(row=>row.PK_COLUMN_NAME),['a','b']);
});
test('catalog and schemata discovery are explicit about SQLite namespace ownership',async t=>{
  const {cn}=await fixture(t);assert.equal((await cn.OpenSchema(1,['main'])).Item('CATALOG_NAME'),'main');const rs=await cn.OpenSchema(17);assert.equal(rs.Item('SCHEMA_NAME'),null);assert.equal(rs.Item('SCHEMA_OWNER'),null);
});
test('schema names containing SQL quotes are handled without interpolation vulnerabilities',async t=>{
  const {cn}=await fixture(t),rs=await cn.OpenSchema(4,[undefined,undefined,'quo"te']);assert.equal(rs.Item('COLUMN_NAME'),'co"l');
  assert.equal((await cn.OpenSchema(20,[undefined,undefined,"child'; DROP TABLE parent; --"])).RecordCount,0);assert.equal((await cn.OpenSchema(28,[undefined,undefined,'parent'])).RecordCount,2);
});
test('invalid restrictions, unsupported kinds and provider-specific IDs fail without leaking cursors',async t=>{
  const {cn}=await fixture(t),size=cn.recordsets.size;
  for(const args of [[20,[null,null,null,null,'extra']],[20,[{}]],[20,['x'.repeat(4097)]],[20,[Infinity]],[999],[20,undefined,'{custom}'],[NaN]])await assert.rejects(cn.OpenSchema(...args));
  assert.equal(cn.recordsets.size,size);assert.equal(cn.Errors.Count,1);
});
test('schema errors preserve their ADO error details and valid later discovery clears errors',async t=>{
  const {cn}=await fixture(t);await assert.rejects(cn.OpenSchema(999),code(3251));assert.equal(cn.Errors.Item(0).Number,3251);await cn.OpenSchema(20);assert.equal(cn.Errors.Count,0);
});
test('schema discovery remains read-only even on a writable database',async t=>{
  const {cn}=await fixture(t),rs=await cn.OpenSchema(20);assert.equal(rs.LockType,1);assert.throws(()=>rs.Update('TABLE_NAME','changed'),code(3251));
});
test('schema restrictions cannot silently use absent provider columns',()=>{
  const result={columns:[{Name:'COLUMN_NAME',Type:202}],values:[['a']],rowsAffected:0};assert.throws(()=>restrictSchema(result,schemaRestrictions(4,['main'])),code(3251));
  assert.equal(restrictSchema(result,schemaRestrictions(4,[undefined,undefined,undefined,'A'])).values.length,1);
});
test('late schema responses cannot attach a cursor to a closed connection',async t=>{
  const ctx=new DataContext();t.after(()=>ctx.close());let resolve;
  ctx.providers.set('fixture',class{open(){}close(){}schema(){return new Promise(r=>resolve=r);}});
  const cn=ctx.connection();await cn.Open('Provider=fixture;Data Source=test');const pending=cn.OpenSchema(20),rejected=assert.rejects(pending,code(3704));await cn.Close();
  resolve({columns:[{Name:'TABLE_NAME',Type:202}],values:[['late']]});await rejected;assert.equal(cn.recordsets.size,0);
});
test('DAO keeps original field declarations when consuming the richer ADO column schema',async t=>{
  const ctx=new DataContext();t.after(()=>ctx.close());const engine=ctx.createObject('DAO.DBEngine'),db=await engine.CreateDatabase('/schema.sqlite');
  await db.Execute('CREATE TABLE shapes(id INTEGER PRIMARY KEY,title VARCHAR(23),price DECIMAL_TEXT(18,4),memo TEXT,raw BLOB)');await db.TableDefs.Refresh();
  const fields=db.TableDefs.Item('shapes').Fields;assert.equal(fields.Item('title').Type,10);assert.equal(fields.Item('title').Size,23);assert.equal(fields.Item('price').Type,20);assert.equal(fields.Item('memo').Type,12);assert.equal(fields.Item('raw').Type,11);
});

test('schema columns include generated fields and distinguish rowid from nullable integer PKs',async()=>{
  const context=new DataContext(),cn=context.connection();await cn.Open('Provider=SQLite;Data Source=:memory:');
  try{
    await cn.Execute('CREATE TABLE computed(id INTEGER PRIMARY KEY, n INTEGER, virtual INTEGER AS(n+1), stored INTEGER AS(n+2) STORED)');
    await cn.Execute('CREATE TABLE descending(id INTEGER PRIMARY KEY DESC)');
    await cn.Execute('CREATE TABLE ordinary(id INT PRIMARY KEY)');
    await cn.Execute('CREATE TABLE without_rowid(id TEXT PRIMARY KEY) WITHOUT ROWID');
    const rs=await cn.OpenSchema(4),rows=rs.rows;
    const get=(table,column)=>rows.find(r=>r.TABLE_NAME===table&&r.COLUMN_NAME===column);
    assert.equal(get('computed','id').IS_NULLABLE,0);assert.equal(get('descending','id').IS_NULLABLE,-1);assert.equal(get('ordinary','id').IS_NULLABLE,-1);assert.equal(get('without_rowid','id').IS_NULLABLE,0);
    assert.equal(get('computed','virtual').SQLITE_HIDDEN,2);assert.equal(get('computed','stored').SQLITE_HIDDEN,3);
  }finally{await context.close();}
});

test('read-only catalog introspection and commented SELECTs never serialize the database',async()=>{
  let writes=0;const context=new DataContext({}, {persist:()=>{writes++;}}),cn=context.connection();await cn.Open('Provider=SQLite;Data Source=/catalog.sqlite');
  try{
    await cn.Execute('CREATE TABLE t(id INTEGER PRIMARY KEY, note TEXT)');writes=0;
    for(const kind of [1,4,12,17,20,23,27,28])await cn.OpenSchema(kind);
    await cn.Execute('-- comment\n SELECT * FROM t');await cn.Execute('/* leading */ PRAGMA integrity_check');
    assert.equal(writes,0);assert.equal(cn.adapter.entry.dirty,false);
  }finally{await context.close();}
});
