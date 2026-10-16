import {VBError} from '../language/errors.js';
import {coerce,numeric,VBCurrency,VBDecimal} from './values.js';

const invalid=()=>{throw new VBError('Invalid procedure call or argument',5);};
function triState(value,fallback) {
  value=coerce(value,'Integer');
  if(value===-2)return fallback;
  if(value!==-1&&value!==0)invalid();
  return value===-1;
}
/** Explicit portable regional defaults; no browser/OS locale is inferred.
 * The optional host numberFormat object can select locale/currency and defaults.
 * Microsoft reference: FormatNumber/FormatCurrency/FormatPercent in VBA.
 */
export function numberFormatLibrary(options={}) {
  const locale=options.locale??'en-US',currency=options.currency??'USD';
  const cache=new Map();
  const formatter=(kind,digits,group)=>{
    const key=[kind,digits,group].join('/');
    if(cache.has(key))return cache.get(key);
    let result;
    try {
      result=new Intl.NumberFormat(locale,{style:kind==='number'?'decimal':kind,currency,
        useGrouping:group,minimumFractionDigits:digits,maximumFractionDigits:digits});
    }catch {invalid();}
    if(cache.size>=32)cache.delete(cache.keys().next().value);
    cache.set(key,result);return result;
  };
  function format(kind,value,digits=-1,leading=-2,parens=-2,group=-2) {
    // Coercion precedes cache lookup; invalid calls must not mutate runtime state.
    const exact=value instanceof VBCurrency||value instanceof VBDecimal?value.toString():null;
    value=numeric(value);digits=coerce(digits,'Integer');
    if(digits===-1)digits=options[kind+'Digits']??2;
    if(!Number.isInteger(digits)||digits<0||digits>99)invalid();
    leading=triState(leading,options.leadingDigit??true);
    parens=triState(parens,options.negativeParentheses??(kind==='currency'));
    group=triState(group,options.groupDigits??true);
    const f=formatter(kind,digits,group),negative=value<0;
    // Formatting magnitude separately keeps the currency/percent placement
    // correct when a leading zero is omitted or parentheses are requested.
    const source=exact===null?(negative&&parens?-value:value):(negative&&parens?exact.slice(1):exact);
    const parts=f.formatToParts(source);
    const zero=f.formatToParts(0).find(p=>p.type==='integer').value;
    const hasNonzeroInteger=parts.some(p=>p.type==='integer'&&p.value.split(zero).join('')!=='');
    let text=parts.filter(p=>leading||hasNonzeroInteger||p.type!=='integer'||!parts.some(x=>x.type==='decimal')).map(p=>p.value).join('');
    if(negative&&parens)text='('+text+')';
    return text;
  }
  return {
    FormatNumber:(...args)=>format('number',...args),
    FormatCurrency:(...args)=>format('currency',...args),
    FormatPercent:(...args)=>format('percent',...args),
  };
}
