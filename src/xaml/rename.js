import {EditorIntelligence,wordAt} from '../editor/intelligence.js';
import {syntaxTokens} from '../language/source-scanner.js';
import {preprocess} from '../language/conditional.js';
import {applyTextEdits} from '../../packages/xaml-compiler/src/index.js';

const key=value=>String(value??'').replace(/^\[|\]$/g,'').replace(/[$%&!#@]$/,'').toLowerCase();
const identity=s=>s?.moduleId&&s.name?[s.moduleId,s.ownerId??'',s.parentType??'',key(s.name)].join('|'):null;

/** Bind against the ORIGINAL project, then apply all edits simultaneously. A
 * control name is not a project-wide string: locals, other forms and unrelated
 * object members must keep their names. Uses the editor's shared declaration,
 * expression, With-block and type-library resolution rather than another parser. */
export function renameXamlCode(project,moduleId,changes) {
  const result=new Map(project.modules.map(m=>[m.id,{code:m.code}]));
  if(!changes.length)return result;
  const service=new EditorIntelligence(),owner=project.modules.find(m=>m.id===moduleId);
  if(!owner?.form)throw new Error('The renamed form module no longer exists.');
  const index=service.index(owner,project),targets=new Map(),candidates=new Set();
  const add=(symbol,name)=>{targets.set(identity(symbol),{symbol,name});candidates.add(key(symbol.name));};
  for(const [oldName,newName] of changes) {
    if(!/^[A-Za-z_]\w*$/.test(newName))throw new Error('Invalid VB6 component name '+newName+'.');
    if(key(oldName)===key(owner.name))add({name:oldName,moduleId,kind:'module'},newName);
    else {
      const control=index.symbols.find(s=>s.kind==='control'&&key(s.name)===key(oldName));
      if(!control)throw new Error('Cannot resolve the renamed control '+oldName+'.');
      add(control,newName);
      // Rename actual event-shaped procedures, not arbitrary prefix matches in
      // variables/strings. Calls bind to the same procedure identity.
      for(const procedure of index.procedures)if(key(procedure.name).startsWith(key(oldName)+'_'))add(procedure,newName+procedure.name.slice(oldName.length));
    }
  }
  const finalNames=new Map();
  for(const [id,{symbol,name}] of targets) {
    const collision=index.symbols.find(s=>!s.ownerId&&key(s.name)===key(name)&&identity(s)!==id&&!targets.has(identity(s)));
    if(collision)throw new Error('The rename would collide with '+name+' in '+owner.name+'.');
    if(finalNames.has(key(name))&&finalNames.get(key(name))!==id)throw new Error('Two renamed symbols would have the name '+name+'.');
    finalNames.set(key(name),id);
    if(symbol.kind==='module'&&project.modules.some(m=>m.id!==moduleId&&key(m.name)===key(name)))throw new Error('The project already contains module '+name+'.');
  }
  let count=0;
  for(const module of project.modules) {
    const code=module.code??'',lines=code.split('\n'),edits=[];
    // An inactive branch can declare a different scope. Never guess that all
    // alternate builds bind the same names as the current configuration.
    const enabled=/^\s*#(?:If|Const)\b/im.test(code)?preprocess(code,project.settings?.conditionalConstants??{},module.name).split('\n'):null;
    let base=0;
    for(let line=0;line<lines.length;line++) {
      for(const token of syntaxTokens(lines[line])) {
        if(!['id','bracket'].includes(token.kind)||!candidates.has(key(token.value)))continue;
        if(enabled&&!enabled[line]?.trim())throw new Error('Rename requires review of an inactive conditional-compilation branch in '+module.name+'.');
        const start=base+token.start,end=base+token.end,offset=start+Math.min(1,end-start);
        const symbol=service.definition(project,module,line+1,code,offset),id=identity(symbol),target=targets.get(id);
        if(!target)continue;
        if(++count>100000)throw new RangeError('XAML rename exceeds 100,000 bound references.');
        const expression=wordAt(code,offset).text;
        const replacement=token.kind==='bracket'?'['+target.name+']':target.name;
        const prospective=expression.slice(0,expression.length-token.value.length)+replacement;
        const collision=service.resolve(project,module,line+1,prospective,{offset});
        if(collision&&identity(collision)!==id&&!targets.has(identity(collision)))throw new Error('The rename would capture '+target.name+' in '+module.name+' at line '+(line+1)+'.');
        edits.push({start,end,text:replacement});
      }
      base+=lines[line].length+1;
    }
    const attributes=module.attributes?.map(line=>{
      const tokens=syntaxTokens(line),name=tokens[1];
      if(key(tokens[0]?.value)!=='attribute'||!name)return line;
      if(tokens[2]?.value==='.') {
        const target=targets.get(identity({moduleId:module.id,name:key(name.value)}));
        if(target)return applyTextEdits(line,[{start:name.start,end:name.end,text:name.kind==='bracket'?'['+target.name+']':target.name}]);
      }
      if(key(name.value)==='vb_name'&&module.id===moduleId) {
        const target=targets.get(identity({moduleId,name:owner.name})),value=tokens[3];
        if(target&&value?.kind==='string'&&key(value.value.slice(1,-1))===key(owner.name))return applyTextEdits(line,[{start:value.start,end:value.end,text:'"'+target.name+'"'}]);
      }
      return line;
    });
    result.set(module.id,{code:applyTextEdits(code,edits),...(attributes?{attributes}:{})});
  }
  return result;
}
