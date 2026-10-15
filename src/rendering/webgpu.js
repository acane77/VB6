import {textureUploadRegion, rememberTextureUpload} from './texture-updates.js';
import {acquireDevice, deadline, subscribeDeviceLoss} from './device.js';
import {physicalSize} from './policy.js';
import {PaintScene} from './scene.js';
import {encodeInstances, instanceUpdateRange, rememberInstances, prepareBatches, recordInstanceUpload} from './instances.js';
// Clip/mode are constant for all vertices of an instance. Either provoking
// vertex therefore preserves identical pixels and supports Compatibility mode.
// https://gpuweb.github.io/gpuweb/wgsl/#interpolation
export const UI_SHADER = `
struct Screen { size: vec2f, scale: vec2f };
@group(0) @binding(0) var<uniform> screen: Screen;
@group(1) @binding(0) var image: texture_2d<f32>;
struct Output {
 @builtin(position) position: vec4f,
 @location(0) uv: vec2f,
 @location(1) color: vec4f,
 @location(2) @interpolate(flat, either) clip: vec4f,
 @location(3) @interpolate(flat, either) mode: f32
};
@vertex fn vs(@builtin(vertex_index) vertex: u32,
 @location(0) rect: vec4f, @location(1) clip: vec4f,
 @location(2) color: vec4f, @location(3) color2: vec4f,
 @location(4) uv: vec4f, @location(5) paintFlags: vec4f) -> Output {
 let corners = array<vec2f, 6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
 let p = corners[vertex]; let xy = rect.xy + p * rect.zw;
 var out: Output;
 out.position = vec4f(xy.x / screen.size.x * 2.0 - 1.0, 1.0 - xy.y / screen.size.y * 2.0, 0.0, 1.0);
 out.uv = uv.xy + p * uv.zw; out.clip = clip; out.mode = paintFlags.x;
 out.color = mix(color, color2, select(p.x, p.y, paintFlags.y > 0.5));
 return out;
}
@fragment fn fs(input: Output) -> @location(0) vec4f {
 let xy = floor(input.position.xy);
 if (any(xy < input.clip.xy) || any(xy >= input.clip.xy + input.clip.zw)) { discard; }
 if (input.mode > 1.5) { return vec4f(0); }
 var color = input.color;
 if (input.mode > 0.5) {
   let size = textureDimensions(image);
   let pixel = clamp(vec2i(floor(input.uv * vec2f(size))), vec2i(0), vec2i(size) - vec2i(1));
   color = textureLoad(image, pixel, 0) * input.color;
 }
 return vec4f(color.rgb * color.a, color.a);
}`;
/** Instanced, clipped, demand-submitted sRGB UI quads. No screenshots of HTML. */
export class WebGPUPainter {
  static async create(canvas, {onLost = () => {}, timeout = 3000} = {}) {
    const painter = new WebGPUPainter(canvas, onLost);
    try { await deadline(painter.initialize(timeout), timeout * 2); await painter.verifyOutput(timeout); return painter; }
    catch (error) {
      painter.dispose();
      // GPUValidationError is a WebIDL GPUError, not a JavaScript Error. Keep
      // its message across promise consumers (including browser automation).
      throw error instanceof Error ? error : new Error(error?.message || String(error), {cause: error});
    }
  }
  constructor(canvas, onLost) {
    this.canvas = canvas; this.view = canvas.ownerDocument.defaultView; this.onLost = onLost; this.name = 'webgpu'; this.disposed = false;
    this.textures = new Map(); this.stats = {frames: 0, drawCalls: 0, uploadedBytes: 0, bufferAllocations: 0, geometryPacks: 0, instanceUploads: 0, readbacks: 0, outputVerified: false};
  }
  async initialize(timeout) {
    const {device, info} = await acquireDevice(this.view, timeout);
    if (this.disposed) return;
    this.device = device; this.adapterInfo = info;
    this.context = this.canvas.getContext('webgpu'); if (!this.context) throw new Error('WebGPU canvas context unavailable');
    this.format = this.view.navigator.gpu.getPreferredCanvasFormat();
    const module = device.createShaderModule({label: 'VB6 UI quads', code: UI_SHADER});
    const diagnostics = await module.getCompilationInfo();
    if (this.disposed) return;
    if (diagnostics.messages.some(m => m.type === 'error')) throw new Error(diagnostics.messages.filter(m => m.type === 'error').map(m => m.message).join('\n'));
    const {GPUBufferUsage: B, GPUTextureUsage: T} = this.view;
    device.pushErrorScope('validation');
    try {
      this.context.configure({device, format: this.format, alphaMode: 'premultiplied', colorSpace: 'srgb', usage: T.RENDER_ATTACHMENT | T.COPY_SRC});
      const screenLayout = device.createBindGroupLayout({entries: [{binding: 0, visibility: this.view.GPUShaderStage.VERTEX | this.view.GPUShaderStage.FRAGMENT, buffer: {type: 'uniform'}}]});
      this.imageLayout = device.createBindGroupLayout({entries: [{binding: 0, visibility: this.view.GPUShaderStage.FRAGMENT, texture: {sampleType: 'unfilterable-float'}}]});
      const layout = device.createPipelineLayout({bindGroupLayouts: [screenLayout, this.imageLayout]});
      const descriptor = {layout, vertex: {module, entryPoint: 'vs', buffers: [{arrayStride: 96, stepMode: 'instance', attributes: Array.from({length: 6}, (_, i) => ({shaderLocation: i, offset: i * 16, format: 'float32x4'}))}]}, fragment: {module, entryPoint: 'fs', targets: [{format: this.format, blend: {color: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}, alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}}}]}, primitive: {topology: 'triangle-list'}};
      this.pipeline = device.createRenderPipeline(descriptor);
      this.holePipeline = device.createRenderPipeline({...descriptor, fragment: {...descriptor.fragment, targets: [{format: this.format}]}});
      this.uniform = device.createBuffer({size: 16, usage: B.UNIFORM | B.COPY_DST});
      this.screenGroup = device.createBindGroup({layout: screenLayout, entries: [{binding: 0, resource: {buffer: this.uniform}}]});
      this.white = device.createTexture({size: [1, 1], format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST});
      device.queue.writeTexture({texture: this.white}, new Uint8Array([255, 255, 255, 255]), {bytesPerRow: 4}, [1, 1]);
      this.whiteGroup = device.createBindGroup({layout: this.imageLayout, entries: [{binding: 0, resource: this.white.createView()}]});
    } finally {
      const error = await device.popErrorScope(); if (error) throw error;
    }
    if (this.disposed) { this.disposeResources(); return; }
    this.errorHandler = event => { if (!this.disposed) this.onLost('WebGPU error: ' + event.error.message); };
    device.addEventListener('uncapturederror', this.errorHandler);
    this.unsubscribeLoss = subscribeDeviceLoss(device, info => { if (!this.disposed) this.onLost('WebGPU device lost: ' + (info.message || info.reason)); });
  }
  image(page) {
    if (!page) return this.whiteGroup;
    let record = this.textures.get(page);
    if (record && (record.width !== page.width || record.height !== page.height)) { record.texture.destroy(); this.textures.delete(page); record = null; }
    if (!record) {
      const T = this.view.GPUTextureUsage;
      const texture = this.device.createTexture({size: [page.width, page.height], format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST | T.RENDER_ATTACHMENT});
      record = {texture, width: page.width, height: page.height, revision: -1, group: this.device.createBindGroup({layout: this.imageLayout, entries: [{binding: 0, resource: texture.createView()}]})}; this.textures.set(page, record);
    }
    const region = textureUploadRegion(page, record);
    if (region) {
      const {x, y, width, height} = region;
      this.device.queue.copyExternalImageToTexture({source: page.canvas, origin: [x, y]},
        {texture: record.texture, origin: [x, y], premultipliedAlpha: false}, [width, height]);
      rememberTextureUpload(record, page, region, this.stats);
    }
    return record.group;
  }
  render(scene, {readback = false, timing = null} = {}) {
    if (this.disposed) throw new Error('Renderer disposed');
    const {groups, pages: usedPages} = prepareBatches(this, scene);
    for (const [page, record] of this.textures) if (!usedPages.has(page)) { record.texture.destroy(); this.textures.delete(page); }
    const device = this.device, size = physicalSize(scene.width, scene.height, scene.dpr, device.limits.maxTextureDimension2D);
    if (this.canvas.width !== size.width) this.canvas.width = size.width;
    if (this.canvas.height !== size.height) this.canvas.height = size.height;
    const count = scene.commands.length, required = Math.max(96, count * 96);
    if (required > device.limits.maxBufferSize) throw new RangeError('UI vertex buffer exceeds device limit');
    if (!this.buffer || required > this.capacity) {
      this.buffer?.destroy(); this.capacity = Math.min(device.limits.maxBufferSize, Math.max(4096, 2 ** Math.ceil(Math.log2(required))));
      this.buffer = device.createBuffer({size: this.capacity, usage: this.view.GPUBufferUsage.VERTEX | this.view.GPUBufferUsage.COPY_DST});
      this.data = new Float32Array(this.capacity / 4); this.stats.bufferAllocations++;
    }
    const update = instanceUpdateRange(this, scene, size), reuse = update.first === update.end;
    if (!reuse) { encodeInstances(scene.commands, this.data, size.scaleX, size.scaleY, update.first, update.end); this.stats.geometryPacks++; }
    const images = new Map();
    for (const page of usedPages) images.set(page, this.image(page));
    const screen = this.screenData || (this.screenData = new Float32Array(4));
    const values = [scene.width, scene.height, size.scaleX, size.scaleY];
    if (!this.screenUploaded || values.some((v, i) => Math.fround(v) !== screen[i])) {
      screen.set(values); device.queue.writeBuffer(this.uniform, 0, screen); this.screenUploaded = true;
    }
    if (!reuse) {
      device.queue.writeBuffer(this.buffer, update.first * 96, this.data, update.first * 24, (update.end - update.first) * 24);
      recordInstanceUpload(this.stats, update.first, update.end);
    }
    rememberInstances(this, scene, size);
    const encoder = device.createCommandEncoder({label: 'VB6 UI frame'});
    const texture = this.context.getCurrentTexture();
    const pass = encoder.beginRenderPass({...(timing ? {timestampWrites: {querySet: timing.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1}} : {}), colorAttachments: [{view: texture.createView(), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store'}]});
    pass.setBindGroup(0, this.screenGroup); pass.setVertexBuffer(0, this.buffer);
    for (const group of groups) { pass.setPipeline(group.hole ? this.holePipeline : this.pipeline); pass.setBindGroup(1, group.page ? images.get(group.page) : this.whiteGroup); pass.draw(6, group.count, 0, group.first); }
    pass.end();
    // Optional diagnostic timestamps are resolved with this pass, not wall-clock
    // queue completion. Normal frames allocate no queries and perform no waits.
    // Source: https://www.w3.org/TR/webgpu/#timestamp-query
    if (timing) {
      encoder.resolveQuerySet(timing.querySet, 0, 2, timing.resolve, 0);
      encoder.copyBufferToBuffer(timing.resolve, 0, timing.readback, 0, 16);
    }
    // Queue the copy in the SAME submission as rendering, before automatic
    // canvas-texture expiry. Do not call getCurrentTexture after an await.
    // Source: https://gpuweb.github.io/gpuweb/#automatic-expiry-task-source
    let capture;
    if (readback) {
      const stride = Math.ceil(size.width * 4 / 256) * 256;
      const buffer = device.createBuffer({label: 'VB6 UI readback', size: stride * size.height,
        usage: this.view.GPUBufferUsage.COPY_DST | this.view.GPUBufferUsage.MAP_READ});
      capture = {buffer, stride};
      try { encoder.copyTextureToBuffer({texture}, {buffer, bytesPerRow: stride}, {width: size.width, height: size.height}); }
      catch (error) { buffer.destroy(); throw error; }
    }
    try { device.queue.submit([encoder.finish()]); } catch (error) { capture?.buffer.destroy(); throw error; }
    this.stats.frames++; this.stats.drawCalls = groups.length; this.stats.atlasPages = this.textures.size;
    if (capture) { this.stats.readbacks++; return this.decodeReadback(capture, size); }
  }
  async decodeReadback({buffer, stride}, size) {
    try {
      await deadline(buffer.mapAsync(this.view.GPUMapMode.READ), 5000, 'GPU readback timed out');
      const bytes = new Uint8Array(buffer.getMappedRange()), data = new Uint8Array(size.width * size.height * 4);
      const bgra = this.format.startsWith('bgra');
      for (let y = 0; y < size.height; y++) {
        const row = bytes.subarray(y * stride, y * stride + size.width * 4), at = y * size.width * 4;
        data.set(row, at);
        if (bgra) for (let x = 0; x < row.length; x += 4) { data[at + x] = row[x + 2]; data[at + x + 2] = row[x]; }
      }
      return {width: size.width, height: size.height, data};
    } finally { if (buffer.mapState === 'mapped') buffer.unmap(); buffer.destroy(); }
  }
  async verifyOutput(timeout) {
    const scene = new PaintScene(2, 2);
    scene.add([0, 0, 2, 2], [1, 0, 0, 1]); scene.add([1, 0, 1, 2], [0, 1, 0, 1]);
    const image = await deadline(this.render(scene, {readback: true}), timeout, 'WebGPU output verification timed out');
    if (this.disposed) throw new Error('Renderer disposed during output verification');
    const expected = [255,0,0,255,0,255,0,255,255,0,0,255,0,255,0,255];
    if (image.width !== 2 || image.height !== 2 || image.data.length !== expected.length || image.data.some((channel, index) => channel !== expected[index])) throw new Error('WebGPU output verification failed');
    this.stats.outputVerified = true;
    // Startup diagnostics must not inflate workload frames/uploads/allocations.
    this.buffer?.destroy(); this.buffer = null; this.encodedScene = null; this.batchedScene = null; this.batches = null; this.data = this.encodedData = null;
    for (const name of ['frames','drawCalls','uploadedBytes','bufferAllocations','geometryPacks','instanceUploads','instanceUploadedBytes','textureUploadedBytes','textureUploads','partialTextureUploads','readbacks','batchBuilds']) this.stats[name] = 0;
  }
  disposeResources() {
    this.unsubscribeLoss?.(); this.unsubscribeLoss = null; this.encodedScene = null; this.batchedScene = null; this.batches = null; this.data = this.encodedData = null;
    this.device?.removeEventListener('uncapturederror', this.errorHandler);
    this.buffer?.destroy(); this.uniform?.destroy(); this.white?.destroy();
    for (const record of this.textures.values()) record.texture.destroy(); this.textures.clear();
    this.context?.unconfigure(); this.buffer = this.uniform = this.white = null;
  }
  dispose() { this.disposed = true; this.disposeResources(); }
}
