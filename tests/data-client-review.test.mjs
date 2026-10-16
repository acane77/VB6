import test from 'node:test';
import assert from 'node:assert/strict';
import {DisconnectedRecordset} from '../src/data/recordset.js';
import {ConnectedRecordset} from '../src/data/connected-recordset.js';
import {DataContext} from '../src/data/context.js';

async function sorted(Type){
  const rs=new Type();rs.Fields.Append('id',3);rs.Fields.Append('rank',3);await rs.Open();
  rs.AddNew(['id','rank'],[1,1]);rs.AddNew(['id','rank'],[2,2]);const target=rs.Bookmark;
  rs.Sort='rank ASC';rs.MoveFirst();return {rs,target};
}
for(const Type of [DisconnectedRecordset,ConnectedRecordset])for(const operation of ['Bookmark','Move']){
  test(`${Type.name} ${operation} retains bookmark identity when committing an edit reorders rows`,async()=>{
    const {rs,target}=await sorted(Type);rs.Fields.Item('rank').Value=99;
    if(operation==='Bookmark')rs.Bookmark=target;else await rs.Move(0,target);
    assert.equal(rs.current().id,2);assert.equal(rs.Bookmark,target);assert.equal(rs.EditMode,0);await rs.Close();
  });
}
test('JavaScript bookmark filter inputs cannot mutate the cursor filter after assignment',async()=>{
  const {rs,target}=await sorted(ConnectedRecordset),first=rs.Bookmark,filter=[first];rs.Filter=filter;
  filter[0]=target;filter.push(first);
  assert.deepEqual(rs.Filter,[first]);assert.equal(rs.RecordCount,1);assert.equal(rs.current().id,1);await rs.Close();
});
test('connection errors retain SQLState and NativeError when a driver has no VB error number',async()=>{
  const context=new DataContext();context.providers.set('fixture',class{open(){throw Object.assign(Error('Driver failure'),{sqlState:'42000',nativeError:207});}close(){}});
  const cn=context.connection();
  try{await assert.rejects(cn.Open('Provider=fixture;Data Source=test'),error=>error.number===3001);
    assert.equal(cn.Errors.Item(0).SQLState,'42000');assert.equal(cn.Errors.Item(0).NativeError,207);
  }finally{await context.close();}
});
test('a throwing cancel hook cannot leave a connecting object permanently in StateConnecting',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r),failure=Error('Cancel hook failed'),context=new DataContext();
  context.providers.set('fixture',class{open(){return pending;}cancel(){throw failure;}close(){}});
  const cn=context.connection(),opening=cn.Open('Provider=fixture;Data Source=test');
  const rejected=assert.rejects(opening,error=>error.number===-2147467260);
  try{await Promise.resolve();assert.throws(()=>cn.Cancel(),error=>error===failure);assert.equal(cn.State,0);}
  finally{resolve();await rejected;await context.close();}
  assert.equal(cn.State,0);assert.equal(context.connections.size,0);
});
