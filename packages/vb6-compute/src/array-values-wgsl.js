/** Whole-array value assignment. Descriptors and compiler-owned payload slabs
 * remain stable: values are copied, never aliases to another array's elements.
 * Validate shape, locks, capacity, String lengths and fuel before any mutation.
 * Microsoft contract: destination must be resizable and element types match.
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/can-t-assign-to-an-array
 */
export function arrayValuesWGSL({strings=false}={}) {return `
fn array_copy_value(dst:u32,src:u32,kind:u32) {
  if(vb_error!=0u || vb_halt || dst==src) {return;}
  if(mem[dst+15u]!=1u) {fail(10u);return;}
  let count=mem[src+1u];let old=mem[dst+1u];
  if(count>mem[dst+14u]) {fail(7u);return;}
  var work=14u+max(count,old)*select(1u,2u,kind==1u);
  ${strings?`if(kind==2u) {
    work=14u;
    for(var i=0u;i<max(count,old);i+=1u) {
      let destination=mem[dst+ARRAY_DATA+i];let fixed_length=mem[destination+2u];
      var length=fixed_length;
      if(i<count) {
        let source=mem[src+ARRAY_DATA+i];
        length=select(mem[source],fixed_length,fixed_length!=0u);
        if(length>mem[destination+1u]) {fail(14u);return;}
      }
      work+=length+1u;
    }
  }`:''}
  if(!array_charge(work)) {return;}
  for(var i=0u;i<max(count,old);i+=1u) {
    let destination=dst+ARRAY_DATA+i;
    if(kind==1u) {
      let p=mem[destination];var value=vec2<u32>(0u);
      if(i<count) {let q=mem[src+ARRAY_DATA+i];value=vec2<u32>(mem[q],mem[q+1u]);}
      mem[p]=value.x;mem[p+1u]=value.y;
    } ${strings?`else if(kind==2u) {
      let p=mem[destination];let fixed_length=mem[p+2u];var length=fixed_length;var n=0u;var q=0u;
      if(i<count) {q=mem[src+ARRAY_DATA+i];length=select(mem[q],fixed_length,fixed_length!=0u);n=min(length,mem[q]);}
      for(var j=0u;j<n;j+=1u) {mem[p+3u+j]=mem[q+3u+j];}
      for(var j=n;j<length;j+=1u) {mem[p+3u+j]=32u;}
      mem[p]=length;
    }`:''} else {
      var value=0u;if(i<count) {value=mem[src+ARRAY_DATA+i];}mem[destination]=value;
    }
  }
  for(var i=0u;i<14u;i+=1u) {mem[dst+i]=mem[src+i];}
}
`;}
