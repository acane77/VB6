/** Actual shader execution: errors, bounds, aliasing, frame snapshots and locks. */
globalThis.runComputeArrayValueTests=async function({gpu,test,equal}) {
  const {ARRAY_VALUE_CASES}=await import('/tests/compute-array-values-cases.js');
  for(const c of ARRAY_VALUE_CASES)await test('array values GPU: '+c.name,async()=>{
    const program=await VB6Compute.ComputeProgram.create(gpu,VB6Compute.compileCompute(c.source,c.options));
    try {
      const [lane]=await program.run();equal(lane.error,0);
      for(const [name,value] of Object.entries(c.expected))equal(lane.globals['Module1.'+name],value);
      for(const [name,bounds] of Object.entries(c.bounds||{}))equal(lane.arrays['Module1.'+name].bounds,bounds);
    }finally{await program.dispose();}
  });
};
