/** Check logical file/directory conflicts before extraction, allocation or writes. */
export function assertFileTree(files,directories=[]){
  const names=new Set(),parents=new Set();
  const key=path=>path.replace(/\\/g,'/').split('/').filter(p=>p&&p!=='.').join('/').toLowerCase();
  for(const value of directories){const parts=key(value).split('/').filter(Boolean);while(parts.length){parents.add(parts.join('/'));parts.pop();}}
  for(const value of files){
    const path=key(value);if(names.has(path))throw new Error('Duplicate file path: '+value);names.add(path);
    const parts=path.split('/');parts.pop();while(parts.length){parents.add(parts.join('/'));parts.pop();}
  }
  for(const path of parents)if(names.has(path))throw new Error('File/directory path conflict: '+path);
}
