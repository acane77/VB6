import {McpError, checkAbort} from './protocol.js';

export const SOURCE_RANGE_TEMPLATE = 'vb6://module/{name}/source{?offset,count,revision}';
export const BUILD_MANIFEST_TEMPLATE = 'vb6://build/{artifactId}';
export const BUILD_RANGE_TEMPLATE = 'vb6://build/{artifactId}/bytes{?offset,count}';
function queryNumbers(query, allowed) {
  const result = {};
  for (const [name,value] of new URLSearchParams(query)) {
    if (!allowed.includes(name) || Object.hasOwn(result,name) || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new McpError(-32602,'Unknown, duplicate or invalid resource range parameter.');
    result[name] = Number(value);
  }
  return result;
}
/** Ranged resource reads go through the same permission-checked tools as tool calls. */
export function installResourceRanges(adapter) {
  adapter.templates.push({uriTemplate:SOURCE_RANGE_TEMPLATE,name:'Revision-pinned source range',mimeType:'text/plain'},
    {uriTemplate:BUILD_MANIFEST_TEMPLATE,name:'Caller-owned build manifest',mimeType:'application/json'},
    {uriTemplate:BUILD_RANGE_TEMPLATE,name:'Caller-owned build byte range',mimeType:'application/octet-stream'});
  const read = adapter.readResource.bind(adapter);
  const invoke = (name,args,context) => adapter.tools.find(tool=>tool.name===name).execute(args,context);
  adapter.readResource = async (uri,context={}) => {
    adapter.assertEnabled(); checkAbort(context.signal);
    const source = /^vb6:\/\/module\/([^/?#]+)\/source\?([^#]*)$/.exec(uri);
    if (source) {
      const {offset=0,count=65536,revision} = queryNumbers(source[2],['offset','count','revision']);
      if (offset && revision === undefined) throw new McpError(-32602,'Continuation source reads require revision.');
      let module; try { module=decodeURIComponent(source[1]); } catch { throw new McpError(-32602,'Invalid module URI encoding.'); }
      const data = await invoke('vb6.code.read',{module,offset,count,...(revision===undefined?{}:{expectedRevision:revision})},context);
      const nextUri = data.hasMore ? 'vb6://module/'+encodeURIComponent(data.module)+'/source?offset='+data.nextOffset+'&count='+count+'&revision='+data.revision : undefined;
      return [{uri,mimeType:'text/plain',text:data.code,_meta:{'io.vb6/range':{unit:'utf-16',offset:data.offset,nextOffset:data.nextOffset,total:data.totalCodeUnits,revision:data.revision,...(nextUri?{nextUri}:{})}}}];
    }
    const build = /^vb6:\/\/build\/([a-f0-9]{48})(\/bytes(?:\?([^#]*))?)?$/.exec(uri);
    if (build) {
      const args = build[2] ? queryNumbers(build[3]||'',['offset','count']) : {count:1};
      const data = await invoke('vb6.build.read',{artifactId:build[1],...args},context);
      // The tool envelope has live revision/event counters. Do not leak those into
      // an immutable artifact manifest or its range metadata.
      const {data:blob,encoding,offset,count,nextOffset,hasMore,revision,eventSequence,...metadata} = data;
      if (!build[2]) return [{uri,mimeType:'application/json',text:JSON.stringify({...metadata,chunks:{uriTemplate:'vb6://build/'+build[1]+'/bytes{?offset,count}',unit:'bytes',defaultCount:65536,maxCount:262144}},null,2)}];
      return [{uri,mimeType:'application/octet-stream',blob,_meta:{'io.vb6/range':{...metadata,offset,count,nextOffset,hasMore,...(hasMore?{nextUri:'vb6://build/'+build[1]+'/bytes?offset='+nextOffset+'&count='+(args.count||65536)}:{})}}}];
    }
    return read(uri,context);
  };
}
