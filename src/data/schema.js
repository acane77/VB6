import {VBArray} from '../runtime/values.js';
import {assertData,DATA_LIMITS,dataList,quoteIdentifier} from './common.js';
import {sqlTokens} from './sql-parameters.js';

// Restriction order is the public ADO/OLE DB SchemaEnum contract.
// https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/schemaenum
const RESTRICTIONS=new Map([
  [1,['CATALOG_NAME']],[4,['TABLE_CATALOG','TABLE_SCHEMA','TABLE_NAME','COLUMN_NAME']],
  [12,['TABLE_CATALOG','TABLE_SCHEMA','INDEX_NAME','TYPE','TABLE_NAME']],
  [17,['CATALOG_NAME','SCHEMA_NAME','SCHEMA_OWNER']],
  [20,['TABLE_CATALOG','TABLE_SCHEMA','TABLE_NAME','TABLE_TYPE']],
  [23,['TABLE_CATALOG','TABLE_SCHEMA','TABLE_NAME']],
  [27,['PK_TABLE_CATALOG','PK_TABLE_SCHEMA','PK_TABLE_NAME','FK_TABLE_CATALOG','FK_TABLE_SCHEMA','FK_TABLE_NAME']],
  [28,['TABLE_CATALOG','TABLE_SCHEMA','TABLE_NAME']]
]);
export function schemaRestrictions(kind,criteria){
  if(criteria===undefined||criteria===null)return [];
  assertData(Array.isArray(criteria)||criteria instanceof VBArray&&criteria.bounds.length===1,'Schema restrictions must be a one-dimensional array',3001);
  const names=RESTRICTIONS.get(kind),values=dataList(criteria);
  assertData(names,'Restrictions for this schema are not supported',3251);
  assertData(values.length<=names.length,'Too many schema restrictions',3001);
  return values.flatMap((value,index)=>{
    if(value===undefined||value===null)return [];
    assertData(typeof value==='string'&&value.length<=4096||typeof value==='number'&&Number.isFinite(value),'Invalid schema restriction',3001);
    return [[names[index],value]];
  });
}
export function restrictSchema(result,restrictions){
  if(!restrictions.length)return result;
  const columns=restrictions.map(([name,value])=>{
    const index=result.columns.findIndex(c=>String(c.Name).toUpperCase()===name);
    assertData(index>=0,'Provider does not expose restriction column '+name,3251);return [index,value];
  });
  return {...result,values:result.values.filter(row=>columns.every(([index,value])=>row[index]!=null&&
    (typeof value==='number'?Number(row[index])===value:String(row[index]).toLowerCase()===value.toLowerCase())))};
}

export function sqliteDeclaredType(declaration){
  const text=String(declaration).toUpperCase();
  const type=/GUID|UNIQUEIDENTIFIER/.test(text)?72:/BIGINT/.test(text)?20:/SMALLINT/.test(text)?2:/TINYINT/.test(text)?17:
    /BOOL|\bBIT\b/.test(text)?11:/INT/.test(text)?3:/CURRENCY|MONEY/.test(text)?6:/DECIMAL|NUMERIC/.test(text)?131:
    /DOUBLE|FLOAT|REAL/.test(text)?5:/DATE|TIME/.test(text)?135:/BLOB/.test(text)?205:/BINARY/.test(text)?204:
    /CHAR/.test(text)?202:/TEXT|MEMO|CLOB/.test(text)?203:12;
  const sizes=/\(\s*(\d+)(?:\s*,\s*(\d+))?\s*\)/.exec(text);
  return {type,size:[202,204].includes(type)&&sizes?Number(sizes[1]):null,
    precision:type===131&&sizes?Number(sizes[1]):null,scale:type===131&&sizes?Number(sizes[2]||0):null};
}
const columns=definition=>definition.map(([Name,Type=202])=>({Name,Type}));
function result(definition){return {columns:columns(definition),values:[],rowsAffected:0};}
function add(result,row){assertData(result.values.length<DATA_LIMITS.rows&&(result.values.length+1)*result.columns.length<=DATA_LIMITS.cells,'Schema allocation limit exceeded',7);result.values.push(row);}
const tablePrefix=name=>['main',null,name];

/** SQLite catalog introspection; no guessed native server/Jet metadata. */
export function sqliteSchema(provider,kind){
  provider.requireAccess();assertData(RESTRICTIONS.has(kind),'SQLite schema kind is not supported',3251);
  if(kind===1)return {columns:columns([['CATALOG_NAME'],['DESCRIPTION']]),values:[['main','Embedded SQLite main database']],rowsAffected:0};
  if(kind===17)return {columns:columns([['CATALOG_NAME'],['SCHEMA_NAME'],['SCHEMA_OWNER']]),values:[['main',null,null]],rowsAffected:0};
  const tables=provider.execute("SELECT name,type,sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").values;
  const infoCache=new Map(),indexCache=new Map();
  const tableInfo=name=>{if(!infoCache.has(name))infoCache.set(name,provider.execute('PRAGMA table_xinfo('+quoteIdentifier(name)+')').values);return infoCache.get(name);};
  const indexes=name=>{if(!indexCache.has(name))indexCache.set(name,provider.execute('PRAGMA index_list('+quoteIdentifier(name)+')').values);return indexCache.get(name);};
  if(kind===20){const out=result([['TABLE_CATALOG'],['TABLE_SCHEMA'],['TABLE_NAME'],['TABLE_TYPE']]);for(const [name,type]of tables)add(out,[...tablePrefix(name),type.toUpperCase()]);return out;}
  if(kind===23){
    const out=result([['TABLE_CATALOG'],['TABLE_SCHEMA'],['TABLE_NAME'],['VIEW_DEFINITION']]);
    for(const [name,type,sql]of tables)if(type==='view'){const as=sqlTokens(sql).find(t=>t.kind==='word'&&t.value.toUpperCase()==='AS');add(out,[...tablePrefix(name),as?sql.slice(as.end).trim():null]);}return out;
  }
  if(kind===4){
    const out=result([['TABLE_CATALOG'],['TABLE_SCHEMA'],['TABLE_NAME'],['COLUMN_NAME'],['ORDINAL_POSITION',3],['DATA_TYPE',3],['TYPE_NAME'],['IS_NULLABLE',11],['COLUMN_HASDEFAULT',11],['COLUMN_DEFAULT'],['CHARACTER_MAXIMUM_LENGTH',3],['NUMERIC_PRECISION',3],['NUMERIC_SCALE',3],['PRIMARY_KEY',3],['SQLITE_HIDDEN',3],['SQLITE_ROWID',11]]);
    for(const [name,kind]of tables){
      const info=tableInfo(name),keys=info.filter(row=>row[5]);
      // An INTEGER PRIMARY KEY without a backing PK index aliases rowid.
      // INTEGER PRIMARY KEY DESC has an index and remains nullable in rowid tables.
      const rowid=kind==='table'&&keys.length===1&&/^INTEGER$/i.test(keys[0][2].trim())&&!indexes(name).some(index=>index[3]==='pk')?keys[0]:null;
      for(const row of info){const type=sqliteDeclaredType(row[2]);add(out,[...tablePrefix(name),row[1],row[0]+1,type.type,row[2],!row[3]&&row!==rowid,row[4]!=null,row[4],type.size,type.precision,type.scale,row[5],row[6]||0,row===rowid]);}
    }return out;
  }
  if(kind===28){
    const out=result([['TABLE_CATALOG'],['TABLE_SCHEMA'],['TABLE_NAME'],['COLUMN_NAME'],['ORDINAL',3],['PK_NAME']]);
    for(const [name,type]of tables)if(type==='table'){
      const pk=indexes(name).find(row=>row[3]==='pk')?.[1]??null;
      for(const row of tableInfo(name).filter(row=>row[5]).sort((a,b)=>a[5]-b[5]))add(out,[...tablePrefix(name),row[1],row[5],pk]);
    }return out;
  }
  if(kind===12){
    const out=result([['TABLE_CATALOG'],['TABLE_SCHEMA'],['TABLE_NAME'],['INDEX_NAME'],['PRIMARY_KEY',11],['UNIQUE',11],['TYPE',3],['ORDINAL_POSITION',3],['COLUMN_NAME'],['COLLATION',3],['PARTIAL',11],['SQLITE_COLLATION']]);
    for(const [name,type]of tables)if(type==='table')for(const index of indexes(name)){
      for(const part of provider.execute('PRAGMA index_xinfo('+quoteIdentifier(index[1])+')').values)if(part[5])add(out,[...tablePrefix(name),index[1],index[3]==='pk',!!index[2],3,part[0]+1,part[2],part[3]?2:1,!!index[4],part[4]]);
    }return out;
  }
  const out=result([['PK_TABLE_CATALOG'],['PK_TABLE_SCHEMA'],['PK_TABLE_NAME'],['PK_COLUMN_NAME'],['FK_TABLE_CATALOG'],['FK_TABLE_SCHEMA'],['FK_TABLE_NAME'],['FK_COLUMN_NAME'],['ORDINAL',3],['UPDATE_RULE'],['DELETE_RULE'],['PK_NAME'],['FK_NAME'],['SQLITE_CONSTRAINT_ID',3]]);
  for(const [name,type]of tables)if(type==='table')for(const fk of provider.execute('PRAGMA foreign_key_list('+quoteIdentifier(name)+')').values){
    // SQLite does not expose constraint names. Preserve Null rather than inventing
    // native identifiers; the provider-specific ID distinguishes composite keys.
    let referenced=fk[4];if(referenced==null)referenced=tableInfo(fk[2]).filter(row=>row[5]).sort((a,b)=>a[5]-b[5])[fk[1]]?.[1]??null;
    add(out,[...tablePrefix(fk[2]),referenced,...tablePrefix(name),fk[3],fk[1]+1,fk[5],fk[6],null,null,fk[0]]);
  }return out;
}
