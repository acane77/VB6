// Registration is private to trusted library objects; a forged __type never grants a default property.
const values = new WeakSet();
const types = new WeakMap();
export function dataDefault(object, scalarType) { values.add(object); if (typeof scalarType === 'function') types.set(object, scalarType); return object; }
// Type resolvers are registered only by trusted field/parameter constructors.
export function dataDefaultType(object) { return types.get(object)?.(); }
export function hasDataDefault(object) { return object != null && (typeof object === 'object' || typeof object === 'function') && values.has(object); }

// A private allowlist for legacy public lowercase names such as rdoConnections.
const members = new WeakMap();
export function dataMembers(object,names) { members.set(object,new Set(names.map(name=>name.toLowerCase()))); return object; }
export function hasDataMember(object,name) { return members.get(object)?.has(String(name).toLowerCase()) || false; }

// Only trusted command instances can be used as Recordset.Open sources.
const commands=new WeakSet();
export function registerDataCommand(command){commands.add(command);}
export function isDataCommand(command){return command!=null&&typeof command==='object'&&commands.has(command);}

// Recordset wrappers have public Item/GetRows results but no scalar default.
const objects=new WeakSet();
export function dataObject(object){objects.add(object);return object;}
export function hasDataObject(object){return object!=null&&typeof object==='object'&&objects.has(object);}
