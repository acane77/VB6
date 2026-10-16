import test from 'node:test';
import assert from 'node:assert/strict';
import {DataContext} from '../src/data/context.js';
import {ConnectedRecordset} from '../src/data/connected-recordset.js';
import {DisconnectedRecordset} from '../src/data/recordset.js';
import {VBArray} from '../src/runtime/values.js';
const code=n=>error=>error.number===n;
function memory(){const r=new DisconnectedRecordset();for(const [n,t]of [['id',3],['name',202],['score',3]])r.Fields.Append(n,t);r.Open();for(const row of [[1,'Ada',10],[2,'Grace',20],[3,'Linus',30]])r.AddNew(['id','name','score'],row);r.MoveFirst();return r;}
function connected(t){const ctx=new DataContext(),r=new ConnectedRecordset(ctx);r.Fields.Append('id',3);r.Fields.Append('name',203);r.Fields.Append('bytes',205);r.Fields.Append('date',7);r.Open();for(let id=1;id<=3;id++)r.AddNew(['id','name','bytes','date'],[id,'name '+id,new Uint8Array([id,10,20]),new Date(2020,id,1)]);r.MoveFirst();t.after(()=>ctx.close());return r;}
const ids=r=>r.view().map(row=>row.id);

test('ADO parentheses support OR of AND groups without changing flat operator precedence',()=>{
  const r=memory();r.Filter='(id=1 OR id=2)';assert.deepEqual(ids(r),[1,2]);
  r.Filter='(id=1 AND score=10) OR (id=2 AND score=20)';assert.deepEqual(ids(r),[1,2]);
  r.Filter='id=1 OR id=2 AND score>10';assert.deepEqual(ids(r),[2]);
  r.Filter='((id=1 AND score=10)) OR (id=3 AND score=30)';assert.deepEqual(ids(r),[1,3]);
});
test('explicit OR groups cannot be joined by AND, and failed parsing preserves cursor and pending edit',()=>{
  const r=memory();r.MoveNext();r.Fields.Item('score').Value=21;
  for(const expression of ['(id=1 OR id=2) AND score>0','score>0 AND (id=1 OR id=2)','id=1)','(id=1','()','id=1 OR','id=1 AND (score=10 OR score=20)']){
    assert.throws(()=>r.Filter=expression);assert.equal(r.position,1);assert.equal(r.EditMode,1);assert.equal(r.Filter,'');
  }
  r.CancelUpdate();assert.equal(r.current().score,20);
});
test('ADO escaped field names, string delimiters and quote-wrapped string constants are literal data',()=>{
  const r=new DisconnectedRecordset();r.Fields.Append('a] b',202);r.Open();for(const value of ["'1'","O'Malley",'AND (OR)'])r.AddNew('a] b',value);
  r.Filter="[a]] b] = #'1'#";assert.equal(r.RecordCount,1);assert.equal(r.current()['a] b'],"'1'");
  r.Filter="[a]] b] = 'O''Malley'";assert.equal(r.RecordCount,1);
  r.Filter="[a]] b] = 'AND (OR)'";assert.equal(r.RecordCount,1);
});
test('ADO filters have bounded length, nesting and clause count, including all-group input',()=>{
  const r=memory();assert.throws(()=>r.Filter=' '.repeat(16385),code(7));
  assert.throws(()=>r.Filter='('.repeat(65)+'id=1'+')'.repeat(65),code(7));
  assert.throws(()=>r.Filter=Array(129).fill('id=1').join(' OR '),code(7));
  r.Filter='('.repeat(64)+'id=1'+')'.repeat(64);assert.deepEqual(ids(r),[1]);
});
test('generated truth-table cases independently check equal left-to-right precedence',()=>{
  const r=memory();for(const a of [true,false])for(const b of [true,false])for(const c of [true,false])for(const x of ['AND','OR'])for(const y of ['AND','OR']){
    const ab=x==='AND'?a&&b:a||b,expected=y==='AND'?ab&&c:ab||c;
    r.Filter=`id=${a?1:99} ${x} id=${b?1:99} ${y} id=${c?1:99}`;
    assert.equal(ids(r).includes(1),expected,`${a} ${x} ${b} ${y} ${c}`);
  }
});
test('GetRows copies mutable field values, not live Date and binary references',t=>{
  const r=connected(t),rows=r.GetRows(1);rows.get(2,0)[0]=255;rows.get(3,0).setFullYear(1900);r.MoveFirst();
  assert.equal(r.Item('bytes')[0],1);assert.equal(r.Item('date').getFullYear(),2020);
});
test('invalid GetRows arguments do not move, commit, or cancel a pending edit',t=>{
  const r=connected(t);r.MoveNext();const bookmark=r.Bookmark;r.Fields.Item('name').Value='pending';
  for(const args of [[-2],[NaN],[Infinity],[1,999],[1,undefined,['missing']],[1,String(bookmark)]]){
    assert.throws(()=>r.GetRows(...args));assert.equal(r.position,1);assert.equal(r.EditMode,1);
  }
  r.CancelUpdate();assert.equal(r.Item('name'),'name 2');
});
test('GetRows bounds duplicate-field allocation before constructing its VB array',()=>{
  const r=memory();assert.throws(()=>r.GetRows(-1,undefined,Array(1025).fill('id')),code(7));assert.equal(r.position,0);
});
test('GetRows rounds finite numeric counts using VB integer coercion',()=>{
  const r=memory();assert.equal(r.GetRows(1.5).bounds[1][1],1);assert.equal(r.current().id,3);
  assert.equal(r.GetRows(0).data.length,0);assert.equal(r.current().id,3);
});
test('CompareBookmarks uses acquisition order across sort, filter and clone cursors',t=>{
  const r=connected(t),a=r.Bookmark;r.MoveLast();const b=r.Bookmark,clone=r.Clone();r.Sort='id DESC';r.Filter='id=2';
  assert.equal(r.CompareBookmarks(a,b),0);assert.equal(clone.CompareBookmarks(b,a),2);assert.equal(r.CompareBookmarks(a,a),1);
  assert.throws(()=>r.CompareBookmarks(String(a),b),code(3001));assert.throws(()=>r.CompareBookmarks(a,999),code(3001));
});
test('invalid bookmark assignment is atomic and does not coerce strings into bookmark IDs',t=>{
  const r=connected(t);r.Fields.Item('name').Value='pending';assert.throws(()=>r.Bookmark=999,code(3001));assert.equal(r.EditMode,1);
  assert.throws(()=>r.Bookmark=String(r.Bookmark),code(3001));assert.equal(r.EditMode,1);r.CancelUpdate();
});
test('bookmark filters copy inputs, reject forged scalar types, and work on large selections',t=>{
  const r=connected(t),bookmarks=r.rows.map(row=>r._bookmarks.get(row));r.Filter=VBArray.from(bookmarks);bookmarks.length=0;
  assert.equal(r.RecordCount,3);const copy=r.Filter;copy.length=0;assert.equal(r.RecordCount,3);
  assert.throws(()=>r.Filter=['1'],code(3001));assert.equal(r.RecordCount,3);
});
test('Find applies backward skip in the search direction and reaches BOF/EOF on miss',t=>{
  const r=connected(t);r.MoveLast();r.Find('id>=1',1,-1);assert.equal(r.Item('id'),2);
  r.Find('id=99',0,-1);assert.equal(r.BOF,-1);r.MoveFirst();r.Find('id=99');assert.equal(r.EOF,-1);
});
test('Find rejects composite criteria and invalid numeric arguments before committing an edit',t=>{
  const r=connected(t);r.Fields.Item('name').Value='pending';
  for(const args of [['id=1 OR id=2'],['(id=1)'],['id=1',-1],['id=1',0,0],['id=1',NaN],['id=1',0,1,999]]){
    assert.throws(()=>r.Find(...args));assert.equal(r.EditMode,1);assert.equal(r.position,0);
  }
  r.CancelUpdate();
});
test('Move validates before changing bookmark, uses VB rounding, and clamps safely',t=>{
  const r=connected(t);r.Move(1.5);assert.equal(r.Item('id'),3);
  assert.throws(()=>r.Move(NaN,1));assert.equal(r.Item('id'),3);assert.throws(()=>r.Move(0,999));assert.equal(r.Item('id'),3);
  r.Move(-100);assert.equal(r.BOF,-1);r.Move(100);assert.equal(r.EOF,-1);
});
test('GetString validates before update and advances with explicit delimiters and Null substitution',t=>{
  const r=connected(t);r.Fields.Item('name').Value='pending';for(const count of [-2,NaN,Infinity])assert.throws(()=>r.GetString(2,count));assert.equal(r.EditMode,1);r.CancelUpdate();
  r.Update(['bytes','date'],[null,null]);assert.equal(r.GetString(2,1,'|','\n','NULL'),'1|name 1|NULL|NULL\n');assert.equal(r.Item('id'),2);
});
test('field identity is stable by numeric/name lookup and survives scalar reads',t=>{
  const r=connected(t);assert.equal(r.Fields.Item('name'),r.Fields.Item(1));assert.equal([...r.Fields][1],r.Fields.Item('NAME'));
});
test('GetChunk progresses through fresh Fields.Item calls and copies returned bytes',t=>{
  const r=connected(t);assert.deepEqual([...r.Fields.Item('bytes').GetChunk(1)],[1]);
  assert.deepEqual([...r.Fields.Item('BYTES').GetChunk(1)],[10]);const chunk=r.Fields.Item(2).GetChunk(1);chunk[0]=255;
  assert.deepEqual([...r.Item('bytes')],[1,10,20]);assert.deepEqual([...r.Fields.Item(2).GetChunk(1)],[]);
});
test('reading another field resets chunk position, including reads from a clone',t=>{
  const r=connected(t),clone=r.Clone();r.Fields.Item('bytes').GetChunk(2);void clone.Fields.Item('name').Value;
  assert.deepEqual([...r.Fields.Item('bytes').GetChunk(1)],[1]);r.Fields.Item('name').Value='changed';
  assert.deepEqual([...r.Fields.Item('bytes').GetChunk(1)],[1]);r.CancelUpdate();
});
test('AppendChunk overwrites on its first call, appends on continuation, and resets after another field',t=>{
  const r=connected(t);r.Fields.Item('name').AppendChunk('new');r.Fields.Item('name').AppendChunk(' value');assert.equal(r.Item('name'),'new value');
  void r.Item('id');r.Fields.Item('name').AppendChunk('reset');assert.equal(r.Item('name'),'reset');r.CancelUpdate();assert.equal(r.Item('name'),'name 1');
  r.Fields.Item('bytes').AppendChunk(new Uint8Array([8]));r.Fields.Item('bytes').AppendChunk(new Uint8Array([9]));assert.deepEqual([...r.Item('bytes')],[8,9]);
});
test('chunk writes remain cancellable, size-bounded and type-checked',t=>{
  const r=connected(t);assert.throws(()=>r.Fields.Item('name').AppendChunk(new Uint8Array([0])),code(13));assert.equal(r.EditMode,0);
  assert.throws(()=>r.Fields.Item('bytes').GetChunk(-1),code(5));assert.equal(r.Item('bytes')[0],1);
});
test('field metadata survives provider loading and invalid empty schemas are rejected atomically',t=>{
  const r=connected(t);const old=r.Fields.Item(0);
  assert.throws(()=>r.load({columns:[{Name:'bad',Type:999}],values:[]}),code(3251));assert.equal(r.RecordCount,3);assert.equal(old.Value,1);
  r.load({columns:[{Name:'amount',Type:131,Precision:18,NumericScale:4,Attributes:96}],values:[['12.3456']]});
  assert.equal(r.Fields.Item(0).Precision,18);assert.equal(r.Fields.Item(0).NumericScale,4);assert.equal(r.Fields.Item(0).Attributes,96);
  assert.throws(()=>old.Value,code(3265));
});
test('closed field collections support Delete and safe reuse of the same name',()=>{
  const r=memory();const old=r.Fields.Item('name');r.Close();r.Fields.Delete('NAME');r.Fields.Append('name',202,8);assert.notEqual(r.Fields.Item('name'),old);
  r.Open();r.AddNew('name','new');assert.equal(r.Fields.Item('name').Value,'new');assert.throws(()=>old.Value,code(3265));assert.throws(()=>r.Fields.Delete('name'),code(3219));
});
test('field lookup index invalidation handles delete-plus-append with unchanged column count',()=>{
  const r=memory();r.column('id');r.Close();r.Fields.Delete('score');r.Fields.Append('extra',3);
  assert.equal(r.column('extra').Name,'extra');assert.throws(()=>r.column('score'),code(3265));
});
test('last surviving clone releases an internally owned connection',async t=>{
  const ctx=new DataContext();t.after(()=>ctx.close());const r=new ConnectedRecordset(ctx);await r.Open('SELECT 1 AS id','Provider=SQLite;Data Source=:memory:');
  const cn=r.ActiveConnection,first=r.Clone(),second=first.Clone();await r.Close();assert.equal(cn.State,1);await first.Close();assert.equal(cn.State,1);await second.Close();assert.equal(cn.State,0);assert.equal(ctx.connections.size,0);
});
test('disposing an edited clone invalidates every surviving cached view',t=>{
  const r=connected(t),clone=r.Clone();clone.Sort='id ASC';const cached=clone.view();r.AddNew();r.Fields.Item('id').Value=99;assert.equal(clone.RecordCount,4);
  r.dispose();assert.equal(clone.RecordCount,3);assert.notEqual(clone.view(),cached);assert.equal(clone.view().some(row=>row.id===99),false);
});
test('Supports rejects overflow and negative bitmasks instead of truncating them',t=>{
  const r=connected(t);for(const flags of [-1,2**32+8192,NaN,Infinity])assert.equal(r.Supports(flags),0);assert.equal(r.Supports(8192),-1);
});
