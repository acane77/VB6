import {schemaRestrictions,restrictSchema} from './schema.js';
import {dataDefault,registerDataCommand} from './defaults.js';
import {assertData,dataError,connectionConfiguration,dataList,after} from './common.js';
import {ConnectedRecordset} from './connected-recordset.js';
import {fieldValue,fieldScalarType} from './recordset.js';

import {DataCollection} from './collection.js';
export {DataCollection};

export class ADOConnection {
  constructor(context){
    this.context=context;this.__type='ADODB.Connection';this.ConnectionString='';this.Provider='';this._commandTimeout=30;this._timeoutExplicit=false;this.ConnectionTimeout=15;this.Mode=3;this._state=0;this.recordsets=new Set();
    this.Errors=new DataCollection();this.Errors.Clear=()=>this.Errors.items.splice(0);
    this._generation=0;this._opening=null;this._closing=null;this._adapterClosures=new WeakMap();
    // Native ByRef signature is consumed by the source VM; direct JS callers may omit it.
    this.Execute=(text,affected,options=1)=>this.execute(text,affected,options);
    this.Execute.vbParams=[{name:'CommandText'},{name:'RecordsAffected',byRef:true,optional:true},{name:'Options',optional:true}];
  }
  get State(){return this._state;}
  get CommandTimeout(){return this._commandTimeout;}
  set CommandTimeout(value){value=Number(value);assertData(Number.isFinite(value)&&value>=1&&value<=600,'CommandTimeout must be 1–600 seconds',5);this._commandTimeout=value;this._timeoutExplicit=true;}
  capture(error){
    const e=error?.number!==undefined?error:dataError(error?.message||'Provider operation failed',3001);
    this.Errors.items.splice(0,this.Errors.Count,{Number:e.number,Description:e.message,Source:e.source||'VB6.Data',SQLState:error?.SQLState||error?.sqlState||e.SQLState||e.sqlState||'',NativeError:error?.NativeError??error?.nativeError??e.NativeError??e.nativeError??e.number});return e;
  }
  async guard(action){this.Errors.Clear();try{return await action();}catch(error){throw this.capture(error);}}
  closeAdapter(adapter){
    if(!adapter)return Promise.resolve();
    let closing=this._adapterClosures.get(adapter);
    if(!closing){closing=Promise.resolve().then(()=>adapter.close?.());this._adapterClosures.set(adapter,closing);}
    return closing;
  }
  async Open(connectionString=this.ConnectionString,user='',password='',options=0){
    return this.guard(async()=>{
      assertData(!this._state&&!this._opening&&!this._closing,'Connection is already open or changing state',3705);
      assertData(Number(options)===0,'Asynchronous ADO flags are not supported; VB calls await I/O',3251);
      assertData(!this.context.closed,'Data context is closed',3704);
      const generation=++this._generation;let adapter,opening;
      this._state=2;
      // Opening resources participate in context shutdown, not just fully open connections.
      this.context.connections.add(this);
      try{
        this.ConnectionString=connectionString;
        const config=connectionConfiguration(connectionString,this.context.config.connections);
        if(this.Provider&&!String(connectionString).match(/provider\s*=/i)&&!config.name)config.provider=this.Provider;
        config.provider=String(config.provider||'sqlite').toLowerCase();config.readOnly=!!config.readOnly||Number(this.Mode)===1;
        const Factory=this.context.providers.get(config.provider);
        assertData(Factory,'Provider is unavailable. Configure a named gateway profile for native OLE DB/ODBC databases.',3706);
        if(user||password){
          const bytes=new TextEncoder().encode(String(user)+':'+String(password));
          assertData(bytes.length<=32768,'Connection credential length limit exceeded',7);
          config.headers={...config.headers,Authorization:'Basic '+btoa(String.fromCharCode(...bytes))};
        }
        if(!this._timeoutExplicit)this._commandTimeout=Number(config.timeout||30);
        adapter=new Factory(this.context,config);adapter.timeout=this.CommandTimeout;
        this.adapter=adapter;this._config=config;
        opening=Promise.resolve().then(()=>adapter.open());this._opening=opening;
        await opening;
        assertData(!this.context.closed&&this._state===2&&generation===this._generation,'Connection opening was cancelled',-2147467260);
        this.Provider=config.provider;this._state=1;
      }catch(error){
        try{await this.closeAdapter(adapter);}catch(cleanup){error.cleanupError=cleanup;}
        if(this.adapter===adapter)this.adapter=null;
        if(generation===this._generation)this._state=0;
        this.context.connections.delete(this);
        throw error;
      }finally{if(this._opening===opening)this._opening=null;}
    });
  }
  async query(text,parameters=[],options=1,timeout=this.CommandTimeout,parameterStyle='native',requestOptions={}){
    return this.guard(async()=>{
      assertData(this.State===1,'Connection is closed',3709);
      assertData(Number.isFinite(timeout)&&timeout>=1&&timeout<=600,'Invalid command timeout',5);
      const adapter=this.adapter,generation=this._generation;adapter.timeout=timeout;
      let result;
      if(Number(options)===2){
        assertData(adapter.table,'This provider does not support table commands',3251);
        result=await adapter.table(String(text));
      }else{
        assertData([1,128,129].includes(Number(options)),'Only text/table commands are supported by this provider',3251);
        assertData(['native','odbc'].includes(parameterStyle),'Invalid parameter style',5);
        result=await (parameterStyle==='odbc'&&adapter.executePositional?adapter.executePositional(String(text??''),parameters):adapter.execute(String(text??''),parameters,requestOptions));
      }
      assertData(this.State===1&&this.adapter===adapter&&!this.context.closed,'Connection closed before the query completed',3704);
      assertData(generation===this._generation,'Query was cancelled',-2147467260);
      return result;
    });
  }
  async execute(text,affected,options=1){
    const result=await this.query(text,[],options);affected?.ref?.set(Number(result.rowsAffected||0));
    const rs=new ConnectedRecordset(this.context);rs.ActiveConnection=this;rs.Source=text;rs._options=Number(options);rs.RowsAffected=Number(result.rowsAffected||0);
    // ADO action queries produce a closed recordset; schema-bearing empty SELECTs remain open.
    if(result.columns?.length){rs.load(result,1);this.recordsets.add(rs);}return rs;
  }
  async OpenSchema(kind=20,criteria,schemaID){
    return this.guard(async()=>{
      assertData(this.State===1,'Connection is closed',3709);
      kind=Number(kind);assertData(Number.isSafeInteger(kind),'Invalid schema kind',3001);
      assertData(schemaID===undefined||schemaID===null||schemaID==='','Provider-specific schema IDs are not supported',3251);
      const restrictions=schemaRestrictions(kind,criteria),adapter=this.adapter,generation=this._generation;
      assertData(typeof adapter.schema==='function','Provider does not support schema discovery',3251);
      const raw=await adapter.schema(kind);
      assertData(this.State===1&&this.adapter===adapter&&generation===this._generation&&!this.context.closed,'Connection closed during schema discovery',3704);
      const result=restrictSchema(raw,restrictions),rs=new ConnectedRecordset(this.context);
      rs.ActiveConnection=this;rs.load(result,1);this.recordsets.add(rs);return rs;
    });
  }
  BeginTrans(){return this.guard(()=>{assertData(this.State===1,'Connection is closed',3709);assertData(this.adapter.begin,'Provider does not support transactions',3251);return this.adapter.begin();});}
  CommitTrans(){return this.guard(()=>{assertData(this.State===1,'Connection is closed',3709);assertData(this.adapter.commit,'Provider does not support transactions',3251);return this.adapter.commit();});}
  RollbackTrans(){return this.guard(()=>{assertData(this.State===1,'Connection is closed',3709);assertData(this.adapter.rollback,'Provider does not support transactions',3251);return this.adapter.rollback();});}
  Cancel(){this._generation++;if(this._state===2)this._state=0;this.adapter?.cancel?.();}
  Close(){
    if(this._closing)return this._closing;
    const adapter=this.adapter,opening=this._opening;
    this._generation++;this._state=0;
    // Install the closing promise before invoking provider/user callbacks. Even
    // a throwing or reentrant cancel hook must not skip the disposal phase.
    const closing=Promise.resolve().then(async()=>{
      let failure;const remember=error=>{if(!failure)failure=error;};
      try{adapter?.cancel?.();}catch(error){remember(error);}
      for(const rs of [...this.recordsets])try{rs.dispose();}catch(error){remember(error);}
      try{if(opening)await opening.catch(()=>{});await this.closeAdapter(adapter);}catch(error){remember(error);}
      finally{if(this.adapter===adapter)this.adapter=null;this.context.connections.delete(this);}
      if(failure){this.capture(failure);throw failure;}
    });
    this._closing=closing;
    closing.then(()=>{if(this._closing===closing)this._closing=null;},()=>{if(this._closing===closing)this._closing=null;});
    return closing;
  }
  SetHeader(name,value){assertData(this.State===1&&this.adapter.headers,'Headers are available on HTTP connections only',3251);assertData(!/[\r\n]/.test(String(name)+String(value)),'Invalid HTTP header');this.adapter.headers[String(name)]=String(value);}
}
export class ADOCommand {
  constructor(context){
    this.context=context;this.__type='ADODB.Command';this.CommandText='';this.CommandType=1;this._commandTimeout=30;this._timeoutExplicit=false;this.ActiveConnection=null;this.Prepared=0;
    this._executing=false;this._executionConnection=null;this._executionGeneration=0;registerDataCommand(this);
    this.Parameters=new DataCollection();
    this.Parameters.Append=parameter=>{assertData(parameter&&typeof parameter.Name==='string','Expected an ADO Parameter');assertData(!this.Parameters.items.some(p=>p.Name.toLowerCase()===parameter.Name.toLowerCase()),'Duplicate parameter');this.Parameters.items.push(parameter);};
    this.Parameters.Append.vbRawArgs=true;
    this.Parameters.setItem=(key,value)=>{this.Parameters.Item(key).Value=value;};
    this.Parameters.Delete=key=>{this.Parameters.items.splice(this.Parameters.items.indexOf(this.Parameters.Item(key)),1);};
    this.Execute=(affected,parameters,options)=>this.execute(affected,parameters,options);
    this.Execute.vbParams=[{name:'RecordsAffected',byRef:true,optional:true},{name:'Parameters',optional:true},{name:'Options',optional:true}];
  }
  get CommandTimeout(){return this._commandTimeout;}
  set CommandTimeout(value){value=Number(value);assertData(Number.isFinite(value)&&value>=1&&value<=600,'CommandTimeout must be 1–600 seconds',5);this._commandTimeout=value;this._timeoutExplicit=true;}
  CreateParameter(name='',type=202,direction=1,size=0,value=null){const parameter={Name:String(name),Type:Number(type),Direction:Number(direction),Size:Number(size),Value:value};return dataDefault(parameter,()=>fieldScalarType(parameter.Type));}
  async execute(affected,parameters,options=this.CommandType,target,lock=1){
    assertData(!this._executing,'This command is already executing',3711);
    this._executing=true;
    const generation=++this._executionGeneration;
    let cn,owned=false,transferred=false,failure;
    try{
      // Snapshot and validate before opening an owned connection. Validation
      // failures must never leak a connection or leave a transaction enlisted.
      const text=String(this.CommandText),active=this.ActiveConnection;
      const definitions=this.Parameters.items.map(p=>({...p}));
      assertData(definitions.every(p=>Number(p.Direction)===1),'Output parameters require a provider-specific native interface',3251);
      const supplied=parameters===undefined?definitions.map(p=>p.Value):dataList(parameters);
      assertData(!definitions.length||supplied.length===definitions.length,'Parameter count does not match the command',3001);
      const typed=supplied.map((value,i)=>{
        const p=definitions[i],v=p?fieldValue({Name:p.Name,Type:p.Type,DefinedSize:p.Size},value):value;
        return v instanceof Uint8Array?v.slice():v instanceof Date?new Date(v):v;
      });
      const requestOptions=structuredClone(this._requestOptions||{});
      const explicitTimeout=this._timeoutExplicit?this.CommandTimeout:null;
      cn=typeof active==='string'?this.context.connection():active;owned=typeof active==='string';
      assertData(cn?.query,'Command requires an ActiveConnection',3709);
      this._executionConnection=cn;
      if(owned)await cn.Open(active);
      assertData(generation===this._executionGeneration,'Command was cancelled',-2147467260);
      const http=['rest','graphql','odata'].includes(cn.Provider);
      const values=http?Object.fromEntries(typed.map((value,i)=>[definitions[i]?.Name||String(i),Number(definitions[i]?.Type)===11&&value!=null?Boolean(value):value])):typed;
      const result=await cn.query(text,values,options,explicitTimeout??cn.CommandTimeout,'native',requestOptions);
      assertData(generation===this._executionGeneration,'Command was cancelled',-2147467260);
      affected?.ref?.set(Number(result.rowsAffected||0));
      const rs=target||new ConnectedRecordset(this.context);
      rs.ActiveConnection=cn;rs.Source=text;rs._options=Number(options);rs._parameters=values;rs._requestOptions=requestOptions;rs.RowsAffected=Number(result.rowsAffected||0);
      if(result.columns?.length){rs.load(result,lock);rs._ownedConnection=owned;cn.recordsets.add(rs);transferred=owned;}
      return rs;
    }catch(error){failure=error;throw error;}
    finally{
      try{if(owned&&!transferred)await cn.Close();}catch(cleanup){if(failure)failure.cleanupError=cleanup;else throw cleanup;}
      finally{this._executing=false;this._executionConnection=null;}
    }
  }
  Cancel(){this._executionGeneration++;(this._executionConnection||this.ActiveConnection)?.Cancel?.();}

}

import {DAOEngine,DAODatabase} from './dao.js';
export {DAOEngine,DAODatabase};
