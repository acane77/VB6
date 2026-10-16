import {VBArray} from '../runtime/values.js';
import {vbBytes} from '../automation/component.js';
import {hasDataDefault,hasDataObject} from './defaults.js';
import {assertData,DATA_LIMITS} from './common.js';

/** Convert only registered data-object results at the VB/JavaScript boundary.
 * JavaScript consumers retain Uint8Array; VB receives typed, independent Byte
 * arrays, including BLOB cells inside GetRows. Cycles retain identity and the
 * aggregate result cannot exceed the runtime's existing array-element budget. */
export function nativeDataValue(object,value){
  if(!(value instanceof Uint8Array)&&!(value instanceof VBArray))return value;
  if(!hasDataDefault(object)&&!hasDataObject(object))return value;
  const seen=new Map(),work=[];let elements=0;
  const reserve=count=>{elements+=count;assertData(elements<=DATA_LIMITS.cells,'Data result exceeds the VB array element limit',7);};
  const convert=value=>{
    if(value instanceof Uint8Array){reserve(value.length);return vbBytes(value);}
    if(!(value instanceof VBArray))return value;
    if(seen.has(value))return seen.get(value);
    reserve(value.data.length);
    const copy=Object.assign(Object.create(VBArray.prototype),value,{bounds:value.bounds.map(bound=>bound.slice()),data:new Array(value.data.length),scalarData:value.scalarData?.slice()});
    seen.set(value,copy);work.push([value,copy]);return copy;
  };
  const result=convert(value);
  while(work.length){const [source,target]=work.pop();for(let i=0;i<source.data.length;i++)target.data[i]=convert(source.data[i]);}
  return result;
}
