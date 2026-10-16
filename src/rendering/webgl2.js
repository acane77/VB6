import {textureUploadRegion, rememberTextureUpload} from './texture-updates.js';
import {acquireWebGLContext} from './context.js';
import {physicalSize} from './policy.js';
import {encodeInstances, instanceUpdateRange, rememberInstances, prepareBatches, recordInstanceUpload} from './instances.js';
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 rect; layout(location=1) in vec4 clipping;
layout(location=2) in vec4 color; layout(location=3) in vec4 color2;
layout(location=4) in vec4 texrect; layout(location=5) in vec4 meta;
uniform vec4 screen; out vec2 uv; out vec4 tint; flat out vec4 clip; flat out float mode;
void main() {
 vec2 p[6]=vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));
 vec2 v=p[gl_VertexID], xy=rect.xy+v*rect.zw;
 gl_Position=vec4(xy.x/screen.x*2.-1.,1.-xy.y/screen.y*2.,0,1);
 uv=texrect.xy+v*texrect.zw; tint=mix(color,color2,meta.y>.5?v.y:v.x); clip=clipping; mode=meta.x;
}`;
const FRAGMENT = `#version 300 es
precision highp float; uniform sampler2D image; uniform vec4 screen;
in vec2 uv; in vec4 tint; flat in vec4 clip; flat in float mode; out vec4 outputColor;
void main(){
 vec2 xy=floor(vec2(gl_FragCoord.x,screen.y*screen.w-gl_FragCoord.y));
 if(any(lessThan(xy,clip.xy))||any(greaterThanEqual(xy,clip.xy+clip.zw)))discard;
 if(mode>1.5){outputColor=vec4(0);return;}
 vec4 c=mode>.5?texture(image,uv)*tint:tint; outputColor=vec4(c.rgb*c.a,c.a);
}`;
export class WebGLPainter {
  constructor(canvas, {onLost = () => {}, preserveDrawingBuffer = false} = {}) {
    this.canvas = canvas; this.name = 'webgl2'; this.textures = new Map(); this.stats = {frames: 0, drawCalls: 0, uploadedBytes: 0, bufferAllocations: 0, geometryPacks: 0, instanceUploads: 0};
    const context = acquireWebGLContext(canvas, {preserveDrawingBuffer}), gl = this.gl = context.gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.lost = event => { event.preventDefault(); if (!this.disposed) onLost('WebGL2 context lost'); }; canvas.addEventListener('webglcontextlost', this.lost);
    const shader = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log); } return s; };
    let vertex, fragment;
    try {
      vertex = shader(gl.VERTEX_SHADER, VERTEX); fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
      this.program = gl.createProgram(); gl.attachShader(this.program, vertex); gl.attachShader(this.program, fragment); gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
      this.uniform = gl.getUniformLocation(this.program, 'screen'); this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao); this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      for (let i = 0; i < 6; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 96, i * 16); gl.vertexAttribDivisor(i, 1); }
      this.white = this.texture(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      const extension = gl.getExtension('WEBGL_debug_renderer_info'); this.adapterInfo = {description: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), request: context.request, warnings: context.warnings};
    } catch (error) { this.dispose(); throw error; }
    finally { if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment); }
  }
  texture() {
    const gl = this.gl, texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return texture;
  }
  image(page) {
    if (!page) return this.white;
    const gl = this.gl; let record = this.textures.get(page);
    if (!record) { record = {texture: this.texture(), revision: -1}; this.textures.set(page, record); }
    const region = textureUploadRegion(page, record);
    if (region) {
      gl.bindTexture(gl.TEXTURE_2D, record.texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      if (region.full) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, page.canvas);
      else {
        // WebGL2 can select a canvas subrectangle without getImageData(), a
        // staging canvas, or reallocation. Always restore unpack state.
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, region.x); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, region.y);
        try { gl.texSubImage2D(gl.TEXTURE_2D, 0, region.x, region.y, region.width, region.height, gl.RGBA, gl.UNSIGNED_BYTE, page.canvas); }
        finally { gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); }
      }
      rememberTextureUpload(record, page, region, this.stats);
    }
    return record.texture;
  }
  render(scene) {
    if (this.disposed || this.gl.isContextLost()) throw new Error('WebGL2 context lost');
    try { return this.renderFrame(scene); }
    catch (error) {
      // WebGL reports allocation/upload errors through getError(), not throws.
      // A failed frame must not publish its CPU data or resource cursors as a
      // successful GPU cache: a later retry must allocate and upload again.
      // https://registry.khronos.org/webgl/specs/latest/1.0/#5.14.9
      this.data = this.encodedData = this.encodedScene = null;
      for (const record of this.textures.values()) record.revision = -1;
      throw error;
    }
  }
  renderFrame(scene) {
    const {groups, pages: usedPages} = prepareBatches(this, scene);
    for (const [page, record] of this.textures) if (!usedPages.has(page)) { this.gl.deleteTexture(record.texture); this.textures.delete(page); }
    const gl = this.gl; if (this.disposed || gl.isContextLost()) throw new Error('WebGL2 context lost');
    const size = physicalSize(scene.width, scene.height, scene.dpr, this.maxTextureSize);
    const resized = this.canvas.width !== size.width || this.canvas.height !== size.height;
    if (this.canvas.width !== size.width) this.canvas.width = size.width;
    if (this.canvas.height !== size.height) this.canvas.height = size.height;
    gl.viewport(0, 0, size.width, size.height); gl.disable(gl.DITHER); gl.disable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program); gl.uniform4f(this.uniform, scene.width, scene.height, size.scaleX, size.scaleY); gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const required = Math.max(24, scene.commands.length * 24);
    if (!this.data || this.data.length < required) { this.data = new Float32Array(Math.max(1024, 2 ** Math.ceil(Math.log2(required)))); gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW); this.stats.bufferAllocations++; }
    const update = instanceUpdateRange(this, scene, size), reuse = update.first === update.end;
    if (!reuse) { encodeInstances(scene.commands, this.data, size.scaleX, size.scaleY, update.first, update.end); this.stats.geometryPacks++; }
    const images = new Map();
    for (const page of usedPages) images.set(page, this.image(page));
    if (!reuse) {
      gl.bufferSubData(gl.ARRAY_BUFFER, update.first * 96, this.data.subarray(update.first * 24, update.end * 24));
      recordInstanceUpload(this.stats, update.first, update.end);
    }
    rememberInstances(this, scene, size);
    for (const group of groups) {
      group.hole ? gl.disable(gl.BLEND) : gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.bindTexture(gl.TEXTURE_2D, group.page ? images.get(group.page) : this.white);
      for (let i = 0; i < 6; i++) gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 96, group.first * 96 + i * 16);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, group.count);
    }
    if (!reuse || resized || usedPages.size) { const error = gl.getError(); if (error !== gl.NO_ERROR) throw new Error('WebGL2 rendering error: ' + error); }
    // Demand rendering can run from a synchronous workspace/options transaction,
    // not a RAF callback. Submit the final batch explicitly; a later unchanged
    // retained scene deliberately performs no draw. flush() is non-blocking and
    // does not replace the context, wait on the GPU, or require a polling loop.
    // https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#flush_when_expecting_results
    gl.flush();
    this.stats.flushes = (this.stats.flushes || 0) + 1;
    this.stats.frames++; this.stats.drawCalls = groups.length; this.stats.atlasPages = this.textures.size;
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.encodedScene = null; this.batchedScene = null; this.batches = null; this.data = this.encodedData = null; this.canvas.removeEventListener('webglcontextlost', this.lost);
    const gl = this.gl; if (!gl) return;
    for (const record of this.textures.values()) gl.deleteTexture(record.texture); this.textures.clear();
    gl.deleteTexture(this.white); gl.deleteBuffer(this.buffer); gl.deleteVertexArray(this.vao); gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
