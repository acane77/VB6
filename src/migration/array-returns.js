/** A typed VB6 return is a value-owning SAFEARRAY, not its element type.
 * Keep one representation for public ABI, result storage and forwarding helpers.
 * VbArray preserves runtime rank, lower bounds, unallocated state and deep copies;
 * native local-array proofs do not currently establish a public return ABI. */
export function returnDeclaration(procedure) {
  return {name:procedure.name, type:procedure.returnType || procedure.type,
    bounds:procedure.returnArray ? [] : null, result:true};
}

export function returnType(procedure, context) {
  const type = context.netType(procedure.returnType || procedure.type);
  return procedure.returnArray ? context.runtime('VbArray') + '(Of ' + type + ')' : type;
}
