import {coerce,numeric} from './values.js';

/** VB's 24-bit generator. State belongs to a runtime, not to the JS realm.
 * Algorithm/reference: Microsoft.VisualBasic VBMath (rtRandomNext) and
 * CompilerServices.ProjectData in dotnet/runtime, MIT licensed.
 * https://github.com/dotnet/runtime/blob/main/src/libraries/Microsoft.VisualBasic.Core/src/Microsoft/VisualBasic/VBMath.vb
 */
export function randomLibrary(clock=()=>new Date()) {
  let seed=0x50000;
  const bits=new DataView(new ArrayBuffer(8));
  const mix=word=>{seed=((seed&0xff)|(((word&0xffff)^(word>>>16))<<8))&0xffffff;};
  return {
    Rnd(number=1) {
      number=coerce(number,'Single');
      if(number!==0) {
        if(number<0) {
          bits.setFloat32(0,number,true);
          const word=bits.getUint32(0,true);
          seed=(word+(word>>>24))&0xffffff;
        }
        seed=(Math.imul(seed,0x43fd43fd)+0xc39ec3)&0xffffff;
      }
      return seed/0x1000000;
    },
    Randomize(number) {
      if(number===undefined) {
        const now=clock();
        bits.setFloat32(0,now.getHours()*3600+now.getMinutes()*60+now.getSeconds()+now.getMilliseconds()/1000,true);
        mix(bits.getUint32(0,true));
      } else {
        bits.setFloat64(0,numeric(number),true);
        mix(bits.getUint32(4,true));
      }
    },
  };
}
