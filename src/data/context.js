import {MISSING} from '../runtime/values.js';
import {nativeDataValue} from './native-values.js';
import {createCommonAutomationRegistry} from '../automation/common-objects.js';
import {HttpTransport} from '../automation/http-transport.js';
import {httpCommandOptions} from './service-definitions.js';
import {RDOEngine,RDOConnection,RDOQuery,RDO_CONSTANTS} from './rdo.js';
import {DAOEngine} from './dao.js';
import {normalizeDataSources,assertData,DATA_CONSTANTS} from './common.js';
import {SQLiteProvider} from './sqlite.js';
import {HTTPProvider,GatewayProvider} from './http.js';
import {FileDataProvider} from './files.js';
import {ADOConnection,ADOCommand,DataCollection} from './connection.js';
import {ConnectedRecordset} from './connected-recordset.js';
import {VirtualFileSystem} from '../runtime/filesystem.js';

export class DataContext {
  constructor(project={},options={}){
    this.config=normalizeDataSources(project.dataSources);this.fs=options.fs||new VirtualFileSystem(project.vfs);this.persist=options.persist;
    this.fetch=options.fetch||globalThis.fetch?.bind(globalThis);this.credentialProvider=options.credentialProvider;this.transport=new HttpTransport({fetch:(...args)=>this.fetch(...args),authorize:options.httpAuthorize});
    this.providers=new Map([['sqlite',SQLiteProvider],['rest',HTTPProvider],['odata',HTTPProvider],['graphql',HTTPProvider],['gateway',GatewayProvider],['json',FileDataProvider],['csv',FileDataProvider]]);
    this.commonAutomation=options.commonAutomation===false?null:createCommonAutomationRegistry({transport:this.transport,fs:this.fs,parseXML:options.parseXML}).createSession();
    this.databases=new Map();this.connections=new Set();this.credentials=new Map();this.closed=false;
  }
  connection(){return new ADOConnection(this);}
  command(){return new ADOCommand(this);}
  async credential(name,{closing=false}={}){
    // Cleanup may reuse a credential already granted to this transaction, never acquire a new one.
    assertData(!this.closed||closing&&this.credentials.has(name),'Data context is closed',3704);
    if(this.credentials.has(name))return this.credentials.get(name);
    const value=await this.credentialProvider?.(name);assertData(!this.closed,'Data context is closed',3704);assertData(value,'A runtime credential is required: '+name,70);this.credentials.set(name,value);return value;
  }
  isObjectType(name){if(this.commonAutomation?.has(name))return true;return /^(?:ADODB\.(?:Connection|Command|Recordset|Parameter)|DAO\.(?:DBEngine|Workspace|Database|Recordset|QueryDef|TableDef|Index|Field|Parameter)|(?:RDO\.)?rdo(?:Engine|Connection|Environment|Query|Resultset|Parameter|Column|Table)|VB6\.Data\.(?:Connection|Command))$/i.test(String(name));}
  createObject(name){
    assertData(!this.closed,'Data context is closed',3704);
    if(this.commonAutomation?.has(name))return this.commonAutomation.create(name);
    switch(String(name).toLowerCase()){
      case 'rdo.rdoengine':case 'rdoengine':return new RDOEngine(this);
      case 'rdo.rdoconnection':case 'rdoconnection':return new RDOConnection(this,(this.rdoEngine||(this.rdoEngine=new RDOEngine(this))).rdoEnvironments.Item(0));
      case 'rdo.rdoquery':case 'rdoquery':return new RDOQuery(this);
      case 'adodb.connection':case 'vb6.data.connection':return this.connection();
      case 'adodb.command':case 'vb6.data.command':return this.command();
      case 'adodb.recordset':return new ConnectedRecordset(this);
      case 'dao.dbengine':case 'dao.dbengine.36':case 'dao.dbengine.120':return new DAOEngine(this);
      default:return null;
    }
  }
  environment(){
    const environment={__type:'DataEnvironment',Connections:new DataCollection(),Commands:new DataCollection()};
    environment.SetCredential=(name,value)=>{assertData(!this.closed,'Data context is closed',3704);assertData(typeof name==='string'&&name,'A credential reference is required');this.credentials.set(name,value);};
    environment.ClearCredentials=()=>this.credentials.clear();
    for(const definition of this.config.connections){const cn=this.connection();cn.Name=definition.name;cn.ConnectionString=definition.name;environment[definition.name]=cn;environment.Connections.items.push(cn);}
    for(const definition of this.config.commands){
      const cmd=this.command();cmd.Name=definition.name;cmd.CommandText=definition.text||'';cmd.CommandType=definition.type||1;cmd._requestOptions=httpCommandOptions(definition);cmd.ActiveConnection=environment.Connections.Item(definition.connection);
      for(const p of definition.parameters||[])cmd.Parameters.Append(cmd.CreateParameter(p.name,p.type||202,1,p.size||0,p.value??null));
      environment.Commands.items.push(cmd);environment['rs'+definition.name]=new ConnectedRecordset(this);
      let executing=false;
      environment[definition.name]=async(...args)=>{
        assertData(!this.closed,'Data context is closed',3704);
        assertData(!executing,'This DataEnvironment command is already executing',3711);
        assertData(args.length<=cmd.Parameters.Count,'Too many command parameters',450);
        const values=(definition.parameters||[]).map((p,i)=>{const missing=i>=args.length||args[i]===MISSING;assertData(p.required!==true||!missing,'Argument not optional: '+p.name,449);return missing?(p.value??null):args[i];});
        executing=true;
        try{
          values.forEach((value,i)=>cmd.Parameters.Item(i).Value=value);
          if(cmd.ActiveConnection.State===0)await cmd.ActiveConnection.Open();
          const previous=environment['rs'+definition.name];if(previous.State)await previous.Close();
          return await cmd.execute(undefined,undefined,cmd.CommandType,previous);
        }finally{executing=false;}
      };
      environment[definition.name].vbPreserveMissing=true;
      environment[definition.name].vbParams=(definition.parameters||[]).map(p=>({name:p.name,optional:p.required!==true}));
    }
    return environment;
  }
  install(vm){
    // Adapt registered ADO/DAO/RDO arrays at the VM boundary without changing
    // direct JavaScript provider results. Keep this context-owned so later VM
    // features and graphics dispatch remain untouched by data integration.
    if(!vm.__dataNativeValueAdapter){
      const nativeScalar=vm.nativeScalar,callResolvedExpression=vm.callResolvedExpression;
      vm.nativeScalar=function(object,name,value){return nativeScalar.call(this,object,name,nativeDataValue(object,value));};
      vm.callResolvedExpression=async function(node,target,frame){
        const result=await callResolvedExpression.call(this,node,target,frame);
        return nativeDataValue(target?.receiver??target,result);
      };
      Object.defineProperty(vm,'__dataNativeValueAdapter',{value:true});
    }
    if(vm.host.dataHttpAuthorize!==undefined){assertData(typeof vm.host.dataHttpAuthorize==='function','HTTP host policy must be a function');this.transport.authorize=vm.host.dataHttpAuthorize;}
    if(vm.host.commonAutomation!==undefined)assertData(typeof vm.host.commonAutomation==='boolean','commonAutomation must be Boolean');
    if(vm.host.commonAutomation===false){this.commonAutomation?.close();this.commonAutomation=null;}
    for(const [name,value]of Object.entries({...DATA_CONSTANTS,...RDO_CONSTANTS}))vm.library.set(name.toLowerCase(),value);
    const environment=this.environment();vm.library.set('dataenvironment1',environment);vm.library.set('dataenvironment',environment);
    const rdo=this.rdoEngine||(this.rdoEngine=new RDOEngine(this));vm.library.set('rdoengine',rdo);vm.library.set('rdoenvironments',rdo.rdoEnvironments);vm.library.set('rdoerrors',rdo.rdoErrors);vm.library.set('rdocreateenvironment',(...args)=>rdo.rdoCreateEnvironment(...args));
    const engine=this.daoEngine||(this.daoEngine=new DAOEngine(this));vm.library.set('dbengine',engine);vm.library.set('opendatabase',(...args)=>engine.OpenDatabase(...args));vm.library.set('createdatabase',(...args)=>engine.CreateDatabase(...args));
  }
  close(){
    if(this.closing)return this.closing;
    this.closed=true;this.transport.cancel();
    const work=[...this.connections].map(cn=>cn.Close());work.push(this.commonAutomation?.close());
    return this.closing=Promise.allSettled(work).finally(()=>{this.transport.close();this.credentials.clear();});
  }
}
