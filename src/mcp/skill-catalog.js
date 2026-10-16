import {sha256} from '../core/sha256.js';
import {toBase64} from '../project/frx.js';
import {McpError, MCP_META, validateArguments} from './protocol.js';

export const SKILLS_EXTENSION = MCP_META + 'skills';
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const pathOK = path => typeof path === 'string' && path.length <= 1024 && path.split('/').every(segment => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment) && segment !== '.' && segment !== '..');
const invalid = message => { throw new McpError(-32602, 'Invalid skill catalog: ' + message); };
const missing = () => { throw new McpError(-32602, 'Unknown skill resource or directory.'); };

/** Immutable, offline Skills-extension publisher. No filesystem, activation or tool grants.
 * Definitions are host-authored. Frontmatter and SKILL.md have a single source of truth:
 * JSON scalar/flow values are valid YAML, avoiding a separate parser or lossy projection.
 */
export class McpSkillCatalog {
  #files = new Map(); #skills = new Map(); #directories = new Map(); #prepared;
  constructor(definitions = []) {
    if (!Array.isArray(definitions) || definitions.length > 128) invalid('at most 128 skills');
    let bytes = 0;
    const directory = uri => { if (!this.#directories.has(uri)) { if (this.#directories.size >= 1024) invalid('directory-count limit'); this.#directories.set(uri, new Map()); } };
    const addDirectory = (root, relative = '') => {
      directory(root); let parent = root;
      for (const name of relative ? relative.split('/') : []) {
        const uri = parent + '/' + name;
        this.#directories.get(parent).set(uri, {uri, name, mimeType:'inode/directory'});
        directory(uri); parent = uri;
      }
    };
    const addFile = (root, path, file, frontmatter) => {
      if (!pathOK(path)) invalid('unsafe file path');
      const uri = root + '/' + path;
      if (this.#files.has(uri) || this.#files.size >= 512) invalid('duplicate file or file-count limit');
      const text = typeof file === 'string' ? file : file?.text;
      const binary = file?.bytes;
      if ((text !== undefined) === (binary !== undefined) || text !== undefined && typeof text !== 'string' || binary !== undefined && !(binary instanceof Uint8Array)) invalid('a file needs text or Uint8Array bytes');
      const data = text === undefined ? new Uint8Array(binary) : new TextEncoder().encode(text);
      if (data.length > 1024*1024 || (bytes += data.length) > 4*1024*1024) invalid('content byte limit');
      const mimeType = typeof file === 'object' && file.mimeType || (text === undefined ? 'application/octet-stream' : path.endsWith('.md') ? 'text/markdown' : 'text/plain');
      if (typeof mimeType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType)) invalid('file MIME type');
      const name = path === 'SKILL.md' ? frontmatter.name : path.split('/').at(-1);
      const metadata = {uri, name, mimeType, size:data.length, ...(path === 'SKILL.md' ? {description:frontmatter.description} : {})};
      // Decode the stored bytes, so text transport and the manifest cover identical UTF-8.
      this.#files.set(uri, {data, content:text === undefined ? {blob:toBase64(data)} : {text:new TextDecoder('utf-8',{ignoreBOM:true}).decode(data)}, metadata});
      const parent = path.includes('/') ? path.slice(0,path.lastIndexOf('/')) : '';
      addDirectory(root,parent); this.#directories.get(root + (parent ? '/' + parent : '')).set(uri,metadata);
    };
    for (const definition of definitions) {
      const {path, frontmatter, body, files = {}, directories = []} = definition;
      if (!pathOK(path) || typeof body !== 'string') invalid('path and body are required');
      validateArguments(frontmatter,{type:'object',required:['name','description'],properties:{name:{type:'string',minLength:1,maxLength:64,pattern:'^[a-z0-9]+(?:-[a-z0-9]+)*$'},description:{type:'string',minLength:1,maxLength:1024}}});
      if (frontmatter.name !== path.split('/').at(-1)) invalid('name must equal the final skill-path segment');
      if (!files || typeof files !== 'object' || Array.isArray(files) || ![Object.prototype,null].includes(Object.getPrototypeOf(files))) invalid('files must be a plain map');
      const root = 'skill://' + path, uri = root + '/SKILL.md';
      if (this.#skills.has(uri)) invalid('duplicate skill URI');
      const copy = structuredClone(frontmatter);
      this.#skills.set(uri,{uri,frontmatter:copy});
      const header = Object.entries(copy).map(([key,value]) => JSON.stringify(key) + ': ' + JSON.stringify(value)).join('\n');
      addFile(root,'SKILL.md','---\n'+header+'\n---\n\n'+body,copy);
      for (const [name,file] of Object.entries(files)) { if (name === 'SKILL.md') invalid('SKILL.md is generated from frontmatter and body'); addFile(root,name,file,copy); }
      if (!Array.isArray(directories)) invalid('directories must be an array');
      for (const path of directories) { if (!pathOK(path)) invalid('unsafe directory path'); addDirectory(root,path); }
    }
    // Nested skills are ordinary supporting files of their enclosing skill, and
    // every ancestor directory must expose the exact direct-child view.
    for (const skill of this.#skills.values()) {
      const root=skill.uri.slice(0,-9);
      for (const uri of [...this.#files.keys(),...this.#directories.keys()]) if (uri.startsWith(root+'/')) {
        const relative=uri.slice(root.length+1);
        addDirectory(root,this.#directories.has(uri)?relative:relative.includes('/')?relative.slice(0,relative.lastIndexOf('/')):'');
      }
    }
    for (const uri of this.#directories.keys()) {
      const cut = uri.lastIndexOf('/'); if (cut < 'skill://'.length) continue;
      const parent = uri.slice(0,cut);
      if (this.#directories.has(parent)) this.#directories.get(parent).set(uri,{uri,name:uri.slice(cut+1),mimeType:'inode/directory'});
      if (this.#files.has(uri)) invalid('a path cannot be both a file and a directory');
    }
  }
  async #prepare() {
    if (!this.#prepared) this.#prepared = Promise.all([...this.#files].map(async ([uri,file]) => ({uri,size:file.data.length,
      digest:'sha256:'+Array.from(await sha256(file.data),byte=>byte.toString(16).padStart(2,'0')).join('')})))
      .then(manifest => [...this.#skills.values()].map(skill=>({...skill,resources:manifest.filter(file=>file.uri.startsWith(skill.uri.slice(0,-8))).sort((a,b)=>compare(a.uri,b.uri))})))
      .catch(error=>{this.#prepared=undefined;throw error;});
    return this.#prepared;
  }
  async list() { return structuredClone((await this.#prepare()).sort((a,b)=>compare(a.uri,b.uri))); }
  async get(uri) { const skill=(await this.#prepare()).find(skill=>skill.uri===uri); if (!skill) missing(); return structuredClone(skill); }
  resources() { return [...this.#files.values()].map(file=>structuredClone(file.metadata)).sort((a,b)=>compare(a.uri,b.uri)); }
  read(uri) { const file=this.#files.get(uri); if (!file) missing(); return [{uri,mimeType:file.metadata.mimeType,...file.content}]; }
  directory(uri) { const children=this.#directories.get(uri); if (!children) missing(); return [...children.values()].map(value=>structuredClone(value)).sort((a,b)=>compare(a.uri,b.uri)); }
}
