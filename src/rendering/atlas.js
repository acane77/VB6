import {canvasTextStyle, applyCanvasTextStyle} from './text-style.js';
import {markTextureDirty} from './texture-updates.js';
/** Browser-shaped text runs are rasterized once, then sampled by GPU quads.
 * Pages are bounded and may be reclaimed only before they are used in the
 * current build. No command emitted earlier in that build can be overwritten.
 * No font files, foreignObject snapshots or network dependencies.
 */
export class TextAtlas {
  constructor(document, {size = 1024, maxPages = 4} = {}) {
    if (!Number.isInteger(size) || size < 8 || size > 4096 ||
        !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 16 ||
        size * size * maxPages > 16 * 1024 * 1024) throw new RangeError('Invalid text atlas budget.');
    this.document = document; this.size = size; this.maxPages = maxPages;
    this.pages = []; this.entries = new Map(); this.clock = 0;
    this.stats = {hits: 0, misses: 0, measurements: 0, evictions: 0, compactions: 0, repackedEntries: 0, capacityMisses: 0};
    this.measure = document.createElement('canvas').getContext('2d');
  }
  begin() {
    if (this.pressure) this.compact();
    this.pressure = this.needsCompaction = false; this.clock++;
  }
  end() {
    this.needsCompaction = !!this.pressure && [...this.entries.values()].some(entry => entry.used !== this.clock);
    return this.needsCompaction;
  }
  compact() {
    const live = [...this.entries].filter(([, entry]) => entry.used === this.clock);
    if (live.length === this.entries.size) return;
    const previousPages = this.pages;
    this.pages = []; this.entries = new Map();
    // Repack only between builds. Copy the browser-shaped pixels; never move a
    // UV while an in-progress scene still refers to it. This also recovers stale
    // space when every old page contains one still-visible, pinned text run.
    live.sort((a, b) => b[1].height - a[1].height);
    for (const [key, entry] of live) {
      const box = this.allocate(entry.width, entry.height);
      if (!box) continue; // A later request may rasterize it or use native text.
      box.page.context.drawImage(entry.page.canvas, entry.x, entry.y, entry.width, entry.height,
        box.x, box.y, box.width, box.height);
      markTextureDirty(box.page, [box.x, box.y, box.width, box.height]);
      this.entries.set(key, {...entry, ...box}); box.page.entries.add(key); this.stats.repackedEntries++;
    }
    for (const page of previousPages) { page.canvas.width = page.canvas.height = 1; page.entries.clear(); }
    this.stats.compactions++;
  }
  page() {
    if (this.pages.length >= this.maxPages) return null;
    const canvas = this.document.createElement('canvas'); canvas.width = canvas.height = this.size;
    const context = canvas.getContext('2d'); if (!context) return null;
    const page = {canvas, context, width: this.size, height: this.size, x: 1, y: 1,
      row: 0, revision: 0, used: -1, entries: new Set()};
    this.pages.push(page); return page;
  }
  allocate(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width > this.size - 2 || height > this.size - 2) return null;
    const place = page => {
      let x = page.x, y = page.y, row = page.row;
      if (x + width + 1 > this.size) { x = 1; y += row + 1; row = 0; }
      if (y + height + 1 > this.size) return null;
      page.x = x + width + 1; page.y = y; page.row = Math.max(row, height); page.used = this.clock;
      return {page, x, y, width, height};
    };
    for (const page of this.pages) { const box = place(page); if (box) return box; }
    const created = this.page(); if (created) return place(created);
    // Evict an entire least-recently-used page, not individual shelf entries.
    // Holes left by individual eviction cannot be reused by a shelf allocator.
    let oldest = null;
    for (const page of this.pages) if (page.used !== this.clock && (!oldest || page.used < oldest.used)) oldest = page;
    if (!oldest) return null;
    for (const key of oldest.entries) this.entries.delete(key);
    oldest.entries.clear(); oldest.context.clearRect(0, 0, this.size, this.size);
    oldest.x = oldest.y = 1; oldest.row = 0;
    markTextureDirty(oldest, [0, 0, this.size, this.size]); this.stats.evictions++;
    return place(oldest);
  }
  text(text, style, rect, dpr = 1) {
    if (!this.measure || typeof text !== 'string' || !text || !Number.isFinite(dpr) || dpr <= 0 ||
        !Array.isArray(rect) || rect.length < 2 || !rect.slice(0, 2).every(Number.isFinite)) return null;
    const ctx = this.measure, textStyle = canvasTextStyle(style, ctx);
    if (!textStyle) return null;
    const font = style.font || `${style.fontStyle || 'normal'} ${style.fontWeight || 'normal'} ${style.fontSize} ${style.fontFamily}`;
    const fx = rect[0] * dpr - Math.floor(rect[0] * dpr), fy = rect[1] * dpr - Math.floor(rect[1] * dpr);
    const key = JSON.stringify([text, font, style.color, style.direction, textStyle, dpr, fx, fy]);
    let entry = this.entries.get(key);
    if (entry) this.stats.hits++;
    else {
      this.stats.misses++;
      ctx.font = font; applyCanvasTextStyle(ctx, textStyle); ctx.direction = style.direction || 'ltr';
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const metrics = ctx.measureText(text); this.stats.measurements++;
      const ascent = metrics.fontBoundingBoxAscent ?? parseFloat(style.fontSize), descent = metrics.fontBoundingBoxDescent ?? parseFloat(style.fontSize) * .25;
      const pad = 2, left = Math.max(0, metrics.actualBoundingBoxLeft || 0);
      const width = Math.ceil((Math.max(metrics.width, metrics.actualBoundingBoxRight || 0) + left) * dpr + fx) + pad * 2;
      const height = Math.ceil((ascent + descent) * dpr + fy) + pad * 2;
      const box = this.allocate(width, height);
      if (!box) { this.stats.capacityMisses++; this.pressure = true; return null; }
      const paint = box.page.context; paint.save();
      try {
        paint.beginPath(); paint.rect(box.x, box.y, width, height); paint.clip();
        paint.translate(box.x + pad + fx + left * dpr, box.y + pad + fy); paint.scale(dpr, dpr);
        paint.font = font; applyCanvasTextStyle(paint, textStyle); paint.direction = ctx.direction;
        paint.textAlign = 'left'; paint.textBaseline = 'alphabetic'; paint.fillStyle = style.color; paint.fillText(text, 0, ascent);
      } finally { paint.restore(); }
      markTextureDirty(box.page, [box.x, box.y, width, height]);
      entry = {...box, pad, left, ascent, descent, advance: metrics.width}; this.entries.set(key, entry); box.page.entries.add(key);
    }
    entry.used = entry.page.used = this.clock;
    return {page: entry.page, advance: entry.advance, uv: [entry.x / this.size, entry.y / this.size, entry.width / this.size, entry.height / this.size],
      rect: [(Math.floor(rect[0] * dpr) - entry.pad) / dpr - entry.left,
        (Math.floor(rect[1] * dpr) - entry.pad) / dpr, entry.width / dpr, entry.height / dpr]};
  }
  getStats() { return {...this.stats, pages: this.pages.length, entries: this.entries.size,
    allocatedBytes: this.pages.length * this.size * this.size * 4, budgetBytes: this.maxPages * this.size * this.size * 4}; }
  reset() {
    this.entries.clear();
    // Release the browser backing stores even if an old retained scene has not
    // yet released a page object. Backend changes clear that scene separately.
    for (const page of this.pages) { page.canvas.width = page.canvas.height = 1; page.entries.clear(); }
    this.pages.length = 0; this.pressure = this.needsCompaction = false;
  }
  dispose() { this.reset(); this.measure = null; }
}
