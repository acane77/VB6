import {emitFileRecord} from './file-records.js';
import {parseLeafStatement} from '../language/compiler.js';
import {parseExpression} from '../language/expression.js';
import {parseForHeader, parseLabel, parseComputedBranch} from '../language/statement-headers.js';
import {parseIfHeader, inlineElse} from '../language/statement-syntax.js';
import {statementParts} from '../language/source-scanner.js';
import {splitTop} from '../language/lexer.js';
import {key, identifier, vbString} from './names.js';
import {expression, condition, assignment} from './expressions.js';
import {emitArrayStatement} from './array-statements.js';
import {planSelections, emitCaseClause, emitForHeader} from './control-flow.js';

const label=name=>/^\d+$/.test(name)?String(Number(name)):identifier(name);
const fs='Global.Microsoft.VisualBasic.FileSystem.';
/** Structured source emission shares leaf IR with the execution compiler. */
export function emitStatements(writer,context) {
  const {proc}=context,gosubs=[],withStack=[],blocks=[],selections=[];
  const selectionPlans=planSelections(context);
  let currentStatement;
  const e=n=>expression(n,context),c=n=>condition(n,context),parse=parseExpression;
  const line=text=>writer.line(text,context);
  const open=(text,kind)=>{writer.open(text,context);if(kind)blocks.push(kind);};
  const close=(text,kind)=>{writer.close(text,context);if(kind)blocks.pop();};
  const result=()=>proc.kind==='function'||proc.accessor==='get'?'Return __vbResult':'Return';
  const gosub=name=>{const index=gosubs.length+1;gosubs.push(index);line('__vbReturns.Push('+index+')');line('GoTo '+label(name));line('__vbContinue'+index+':');};
  const emit=text=>{
    const replaced=context.hook('statement',{text,procedure:proc});if(replaced!==undefined){line(replaced);return;}
    let m;text=text.trim();if(!text||/^Rem\b/i.test(text))return;
    if(/^If\b/i.test(text)){
      const h=parseIfHeader(text);open('If '+c(parse(h.condition))+' Then',h.body?null:'if');
      if(h.body){
        const delimiter=inlineElse(h.body),yes=delimiter?h.body.slice(0,delimiter.start):h.body;
        for(const part of statementParts(yes))emit(part.text);
        if(delimiter){writer.close('Else',context);writer.indent++;for(const part of statementParts(h.body.slice(delimiter.end)))emit(part.text);}
        close('End If');
      }return;
    }
    if(/^ElseIf\b/i.test(text)){const h=parseIfHeader(text);writer.close('ElseIf '+c(parse(h.condition))+' Then',context);writer.indent++;return;}
    if(/^Else$/i.test(text)){writer.close('Else',context);writer.indent++;return;}
    if(/^End\s*If$/i.test(text)){close('End If','if');return;}
    if(/^For\s/i.test(text)){
      open(emitForHeader(parseForHeader(text),context),'for');
      return;
    }
    if((m=/^Next(?:\s+(.+))?$/i.exec(text))){for(const name of m[1]?splitTop(m[1]):[''])close('Next'+(name?' '+e(parse(name)):''),'for');return;}
    if((m=/^Do(?:\s+(While|Until)\s+(.+))?$/i.exec(text))){open('Do'+(m[1]?' '+m[1]+' '+c(parse(m[2])):''),'do');return;}
    if((m=/^Loop(?:\s+(While|Until)\s+(.+))?$/i.exec(text))){close('Loop'+(m[1]?' '+m[1]+' '+c(parse(m[2])):''),'do');return;}
    if((m=/^While\s+(.+)$/i.exec(text))){open('While '+c(parse(m[1])),'while');return;}
    if(/^Wend$/i.test(text)){close('End While','while');return;}
    if((m=/^Select\s+Case\s+(.+)$/i.exec(text))){
      const plan=selectionPlans.get(currentStatement)||{selector:parse(m[1]),variant:true};
      const selection={...plan,name:'__vbSelect'+context.temp++};selections.push(selection);
      if(selection.variant)line('Dim '+selection.name+' As Object = '+e(plan.selector));
      open('Select Case '+(selection.variant?'True':e(plan.selector)),'select');return;
    }
    if((m=/^Case\s+(.+)$/i.exec(text))){if(blocks.at(-1)==='case'){writer.indent--;blocks.pop();}open('Case '+emitCaseClause(m[1],selections.at(-1),context),'case');return;}
    if(/^End\s+Select$/i.test(text)){if(blocks.at(-1)==='case'){writer.indent--;blocks.pop();}close('End Select','select');selections.pop();return;}
    if((m=/^With\s+(.+)$/i.exec(text))){
      const node=parse(m[1]),symbol=context.resolve(node),record=[...context.compiled.modules.values()].some(mod=>Object.keys(mod.types).some(t=>key(t)===key(context.type(node))));
      withStack.push([context.withReceiver,context.withSymbol,record]);
      if(record){
        if(symbol?.arrayElement||symbol?.procedure)context.add('MIG_WITH_RECORD_COPY','With on a returned record or array property requires a ByRef value-cell adapter.');
        open('With '+expression(node,context,{reference:true}));context.withReceiver='';
      }else{const temp='__vbWith'+context.temp++;line('Dim '+temp+' = '+expression(node,context,{reference:true}));context.withReceiver=temp;}
      context.withSymbol=symbol;return;
    }
    if(/^End\s+With$/i.test(text)){const previous=withStack.pop()||[];if(previous[2])close('End With');[context.withReceiver,context.withSymbol]=previous;return;}
    if((m=/^Exit\s+(Sub|Function|Property|For|Do)$/i.exec(text))){line(/sub|function|property/i.test(m[1])?result():'Exit '+m[1]);return;}
    if(/^On\s+Error\s/i.test(text)){const target=/^On\s+Error\s+GoTo\s+(.+)$/i.exec(text);line(target&&!/^(0|-1)$/.test(target[1])?'On Error GoTo '+label(parseLabel(target[1])):text);return;}
    if(/^On\s/i.test(text)){
      const h=parseComputedBranch(text),temp='__vbBranch'+context.temp++;line('Dim '+temp+' As Integer = '+context.runtime('VbRuntime.BranchIndex')+'('+e(h.expr)+')');
      open('Select Case '+temp);
      h.labels.forEach((target,index)=>{open('Case '+(index+1));if(h.gosub)gosub(target);else line('GoTo '+label(target));writer.indent--;});
      close('End Select');return;
    }
    if((m=/^Go(To|Sub)\s+(.+)$/i.exec(text))){const target=parseLabel(m[2]);if(/sub/i.test(m[1]))gosub(target);else line('GoTo '+label(target));return;}
    if(/^\d+$/.test(text)){line('GoTo '+label(text));return;}
    if(/^Resume(?:\s|$)/i.test(text)){const target=/^Resume\s+(.+)$/i.exec(text);line(target&&!/^Next$/i.test(target[1])?'Resume '+label(parseLabel(target[1])):text);return;}
    if(/^Return$/i.test(text)){line('GoTo __vbGoSubReturn');return;}
    for(const op of parseLeafStatement(text,context.module,proc,context.line))emitLeaf(op);
  };
  const recordArrayAssignment=op=>{
    if(op.op!=='assign')return false;
    let target=op.target;while(target?.kind==='group')target=target.expr;
    if(target?.kind!=='member')return false;
    let element=target.object;while(element?.kind==='group')element=element.expr;
    while(element?.kind==='member'){element=element.object;while(element?.kind==='group')element=element.expr;}
    if(element?.kind!=='call'||(element.args||[]).some(arg=>arg.kind==='missing'))return false;
    const symbol=context.resolve(element),arraySymbol=context.resolve(element.callee);
    if(!symbol?.arrayElement||!context.record(symbol.type)||context.arrayPlan(arraySymbol))return false;
    const arrayName='__vbArray'+context.temp++,indices=[];
    line('Dim '+arrayName+' = '+expression(element.callee,context,{reference:true}));
    for(const argument of element.args||[]){
      const indexName='__vbIndex'+context.temp++,value=argument.kind==='named'?argument.expr:argument;
      line('Dim '+indexName+' As Integer = CInt('+e(value)+')');indices.push(indexName);
    }
    const access=arrayName+'('+indices.join(', ')+')',recordName='__vbRecord'+context.temp++;
    line('Dim '+recordName+' As '+context.netType(symbol.type)+' = '+access);
    const replace=node=>{
      if(node===element)return {kind:'id',name:recordName};
      if(node?.kind==='group')return {...node,expr:replace(node.expr)};
      if(node?.kind==='member')return {...node,object:replace(node.object)};
      return node;
    };
    context.locals.set(key(recordName),{name:recordName,type:symbol.type,local:true});
    try{line(assignment(replace(target),op.expr,context,{objectSet:op.objectSet,asReturn:context.directReturn}));}
    finally{context.locals.delete(key(recordName));}
    line(access+' = '+recordName);
    return true;
  };
  const emitLeaf=op=>{
    if(emitArrayStatement(op,context,line)||emitFileRecord(op,context,line)||recordArrayAssignment(op))return;
    switch(op.op){
      case 'dim': return; // Hoisted to procedure entry, matching VB6 procedure scope.
      case 'assign': line(assignment(op.target,op.expr,context,{objectSet:op.objectSet,asReturn:context.directReturn}));return;
      case 'expr': line(e(op.expr));return;
      case 'print':{
        if(op.exprs.length>1)context.add('MIG_PRINT_ZONES','Debug.Print multiple-value spacing is not reproduced by Console output.','warning');
        const value=context.options.codeStyle==='native'&&op.exprs.length===1?e(op.exprs[0]):op.exprs.length?'String.Concat(New Object() {'+op.exprs.map(e).join(', ')+'})':'""';
        line((context.target==='console'?'Global.System.Console.'+(op.newline?'WriteLine':'Write'):'Global.System.Diagnostics.Debug.'+(op.newline?'WriteLine':'Write'))+'('+value+')');return;
      }
      case 'assert':line('Global.System.Diagnostics.Debug.Assert('+c(op.expr)+')');return;
      case 'stop':line('Global.System.Diagnostics.Debugger.Break()');return;
      case 'end':line('End');return;
      case 'raiseError':line('Global.Microsoft.VisualBasic.Information.Err().Raise(CInt('+e(op.expr)+'))');return;
      case 'raiseEvent':line('RaiseEvent '+e(op.expr));return;
      case 'form':{
        const target=context.resolve(op.expr);
        if(target?.control){context.add('MIG_DYNAMIC_CONTROL','Dynamic control-array Load/Unload requires control lifetime and event-registration adapters.');return;}
        line(op.action==='load'?'Call '+expression(op.expr,context,{reference:true})+'.CreateControl()':expression(op.expr,context,{reference:true})+'.Close()');return;
      }
      case 'stringAlign':line(e(op.target)+' = '+context.runtime('VbRuntime.Align')+'('+e(op.expr)+', Len('+e(op.target)+'), '+(op.right?'True':'False')+')');return;
      case 'stringMid':line(e(op.target)+' = '+context.runtime('VbRuntime.MidAssign')+'('+[e(op.target),e(op.start),e(op.expr),...(op.length?[e(op.length)]:[])].join(', ')+')');return;
      case 'fileOpen':{
        const permission={'read':'Read','write':'Write','read write':'ReadWrite'}[op.access]||'Default',sharing={'shared':'Shared','lock read':'LockRead','lock write':'LockWrite','lock read write':'LockReadWrite'}[op.sharing]||'Default';
        line(fs+'FileOpen('+[e(op.handle),e(op.path),'Global.Microsoft.VisualBasic.OpenMode.'+op.mode,'Global.Microsoft.VisualBasic.OpenAccess.'+permission,'Global.Microsoft.VisualBasic.OpenShare.'+sharing,op.recordLength?e(op.recordLength):'-1'].join(', ')+')');return;
      }
      case 'fileClose':line(fs+'FileClose('+op.handles.map(e).join(', ')+')');return;
      case 'fileSeek':line(fs+'Seek('+e(op.handle)+', '+e(op.position)+')');return;
      case 'fileCopy':line(fs+'FileCopy('+e(op.sourcePath)+', '+e(op.destination)+')');return;
      case 'fileRename':line(fs+'Rename('+e(op.sourcePath)+', '+e(op.destination)+')');return;
      case 'fileLock':line(fs+(op.unlock?'Unlock':'Lock')+'('+[e(op.handle),...(op.start?[e(op.start)]:[]),...(op.end?[e(op.end)]:[])].join(', ')+')');return;
      case 'filePrint':line(fs+(op.csv?(op.newline?'WriteLine':'Write'):(op.newline?'PrintLine':'Print'))+'('+[e(op.handle),...op.exprs.map(e)].join(', ')+')');return;
      case 'fileInput':for(const target of op.targets)line(op.whole?e(target)+' = '+fs+'LineInput('+e(op.handle)+')':fs+'Input('+e(op.handle)+', '+e(target)+')');return;
      case 'graphics':context.add('MIG_GRAPHICS','Immediate-mode VB6 drawing requires a retained backing-surface adapter.');line("' Unconverted graphics statement retained in original source.");return;
      default:context.add('MIG_STATEMENT','Unconverted statement instruction: '+op.op);line("' Unconverted instruction: "+op.op);return;
    }
  };
  for(const item of proc.statements||[]){
    context.line=item.line;currentStatement=item;
    try{if(item.label)line(label(item.text)+':');else emit(item.text);}
    catch(error){context.add('MIG_STATEMENT_PARSE',error.message);line("' MIGRATION ERROR: "+item.text.replace(/[\r\n]/g,' '));}
  }
  if(gosubs.length||proc.code.some(i=>i.op==='gosubReturn')){
    line(result());line('__vbGoSubReturn:');
    line('If __vbReturns.Count = 0 Then Global.Microsoft.VisualBasic.Information.Err().Raise(3)');
    open('Select Case __vbReturns.Pop()');for(const index of gosubs){open('Case '+index);line('GoTo __vbContinue'+index);writer.indent--;}close('End Select');
    line('Throw New InvalidOperationException("Invalid GoSub continuation")');
  }
}
