import {VBError} from '../language/errors.js';
import {encodeANSI,decodeANSI} from './binary-codec.js';
import {numeric,vbString,coerce,bankersRound} from './values.js';

const invalid=()=>{throw new VBError('Invalid procedure call or argument',5);};
const LOCALES=Object.freeze({1033:'en-US',2057:'en-GB',1031:'de-DE',1036:'fr-FR',1040:'it-IT',1034:'es-ES',3082:'es-ES',1045:'pl-PL',1046:'pt-BR',2070:'pt-PT',1055:'tr-TR',1041:'ja-JP',1042:'ko-KR',2052:'zh-CN',1028:'zh-TW'});
const code=(value,min,max)=>{value=coerce(value,'Long');if(value<min||value>max)invalid();return value;};
const first=value=>{const text=vbString(value);if(!text.length)invalid();return text.charAt(0);};
const ansi=value=>decodeANSI(Uint8Array.of(code(value,0,255)));
/** Explicit Windows-1252 character surface. Unsupported locale conversions
 * fail rather than silently returning the input unchanged. Odd-byte BSTRs and
 * DBCS conversion are deliberately not represented by JavaScript strings.
 */
export function characterLibrary() {
  return {
    Chr:ansi,
    ChrW:value=>String.fromCharCode(code(value,-32768,65535)&65535),
    Asc:value=>encodeANSI(first(value))[0],
    AscW:value=>{const n=first(value).charCodeAt(0);return n>32767?n-65536:n;},
    String(count,character) {
      if(count===null||character===null)return null;
      count=bankersRound(numeric(count));if(count<0||count>10000000)invalid();
      const ch=typeof character==='string'?first(character):ansi(code(character,0,2147483647)%256);
      return ch.repeat(count);
    },
    StrConv(value,conversion,lcid=1033) {
      if(value===null)return null;
      conversion=coerce(conversion,'Integer');lcid=coerce(lcid,'Long');
      const locale=lcid===0?LOCALES[1033]:LOCALES[lcid];
      if(!locale||conversion<0||conversion>3)invalid();
      const text=vbString(value);
      if(conversion===1)return text.toLocaleUpperCase(locale);
      if(conversion===2)return text.toLocaleLowerCase(locale);
      if(conversion===3) {
        // VBA's word separators are whitespace/control characters, not every
        // punctuation boundary (so don't capitalize after apostrophes/hyphens).
        return text.toLocaleLowerCase(locale).replace(/(^|[\u0000\u0009-\u000d\u0020])([^\u0000\u0009-\u000d\u0020])/gu,(_,separator,ch)=>separator+ch.toLocaleUpperCase(locale));
      }
      return text;
    },
  };
}
