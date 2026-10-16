# Retained browser graphics

`src/graphics` implements the application drawing surface used by browser
Form/PictureBox controls, the designer grid, chart controls and browser Win32/GDI
bindings. It is independent of the IDE's DOM-scene renderer and of the separate
native/compute compilers.

## Architecture and presentation

- `contract.js`: immutable commands and styles, resource validation, affine
  matrices, clipping, hatch patterns and ROP2/ROP3 truth tables.
- `coordinates.js` and `control-graphics.js`: VB logical coordinate systems,
  current position, property validation and control method adapters.
- `images.js`: origin-clean, owned image snapshots and cancellable decoding.
- `raster.js`: ordered Canvas rasterization, scoped raster-operation scratch
  buffers and append-only replay caches.
- `retained.js`: commands, image ownership, state stack, batching, readback and
  image export, independent of the presentation backend.
- `surface.js`: owning-document lifecycle, demand rendering, resize and GPU
  presentation. A surface never destroys the shared window GPU device.

Opaque, integer-aligned pixels and filled rectangles use cached WebGPU triangle
geometry when their display scaling is exact. Other operations use the same
ordered retained rasterizer for Canvas2D and a cached WebGPU texture. Thus text
is no longer a separate overlay that incorrectly covers later shapes. This is
**not** a claim that curves or text are rasterized in compute shaders. The
existing independently compiled compute target remains separate.

The presentation label describes actual execution, not merely the requested
backend: `WebGPU`, `WebGPU · retained texture`, `WebGPU · GDI texture`,
`Canvas2D`, or a diagnostic fallback. GDI bitmap labels remain compatible with
the existing Win32 browser acceptance tests. An ordinary PaintPicture does not
force other content into the GDI one-pixel backing path.

An unchanged raster cache does not replay its commands. An appended command is
painted once; picture completion, replacement, background/theme/font changes,
resize or document transfer invalidate the relevant cache. GPU vertex data and
texture uploads are reused until their source revision changes. Drawing is
scheduled on demand rather than in a perpetual frame loop.

## Browser VB integration

The source parser retains structural coordinate pairs, nested/indexed receivers
and quoted punctuation. Receiver and argument expressions execute exactly once
in source order. Supported drawing forms include:

```vb
Picture1.ScaleMode = vbPixels
Picture1.ForeColor = vbRed
Picture1.DrawWidth = 3
Picture1.PSet (10, 10)               ' Omitted color uses ForeColor
Picture1.PSet Step(5, 5), vbBlack    ' Explicit zero remains black
Picture1.Line -(100, 15), vbBlue
Picture1.Line Step(5, 5)-Step(30, 20), , B
Picture1.Circle (80, 60), 30, , 0, 1.5707963267948966, 0.5
Picture1.Scale (0, 100)-(100, 0)     ' Custom, reversed vertical scale
```

The adapter supports all ScaleMode values 0–7 at 96 logical DPI, with distinct
horizontal/vertical character units, custom origins/extents, ScaleX/ScaleY and
physical cursor preservation when the coordinate system changes. Device pixel
ratio changes display resolution, not VB coordinates. Hidden Form_Load drawing
uses the authored client dimensions rather than the zero layout dimensions of
a hidden element.

Line, box and PSet update CurrentX/CurrentY to their endpoint; Circle updates it
to its center. Radius is a length, not an absolute coordinate. Circle supports
elliptical aspect, counterclockwise arc endpoints and negative-angle radial
lines. FillStyle applies only to closed geometry. DrawWidth is a logical pixel
width, including centered PSet blocks. DrawStyle 1–4 are solid for widths above
one, without changing the stored DrawStyle property.

All sixteen DrawMode values and all eight FillStyle values are implemented.
Bitwise operations use independent truth tables, not approximate Canvas blend
modes. Logical raster operations use binary coverage (alpha at least 128), so
an opaque XOR stroke drawn twice restores every destination byte, including at
curved coverage edges. This is a defined browser coverage rule, **not native GDI
edge-pixel equivalence**. Hatch phase is stable in the surface coordinate system.

TextWidth/TextHeight use actual browser font measurements and the current
coordinate system. Direct control Print supports multiline text, font face,
size, bold/italic, underline/strike-through and opaque/transparent backgrounds.
It advances the logical cursor. The Image getter exports an owned PNG data URL.
PaintPicture supports owned snapshots, asynchronous insertion order, crop,
stretch, mirrors, alpha, and all 256 ROP3 truth tables; source/destination lengths
use the destination control's coordinate units.

## Surface API

```js
import {GraphicsSurface} from './src/graphics/surface.js';

const surface = new GraphicsSurface(container, {
  backend: 'auto', background: 0xffffff,
  onBackend: label => status.textContent = label
});
surface.batch(s => {
  s.save().setClip(8, 8, 200, 100);
  s.add('rect', [8, 8, 208, 108], 0xeeeeee, true);
  s.text('Ordered content', 16, 16, 0, 'bold 16px sans-serif');
  s.add('ellipse', [100, 64, 32, 20], 0x0000ff, false, 2);
  s.restore();
});
await surface.flush();
const png = await surface.toBlob();
console.log(surface.statistics);
// When the owner is removed permanently:
surface.dispose();
```

`add(kind, coords, color, fill, width, options)` supports `pixel`, `line`, `rect`,
`circle`, `ellipse`, `arc`, `roundrect`, `polyline` and `polygon`.
Rectangles and round-rectangles use endpoint coordinates `(x1,y1,x2,y2)`, not
width/height; round-rectangles append one or two corner radii. Circle is
`(cx,cy,r)`, ellipse is `(cx,cy,rx,ry)`, arc adds start/end angles. Polygon and
polyline coordinates are flat x/y pairs. `path` accepts bounded M/L/Q/C/Z
segments, including nonzero or even-odd fill rules.

`setState`, `save`/`restore`, `setClip`/`clip`/`resetClip`, and affine
`setTransform`/`transform`/`resetTransform` snapshot state before retention.
Clips are in surface coordinates; transforms affect command geometry. Invalid
inputs fail before command/cursor mutation. Colors must be immutable OLE_COLOR
integers or bounded CSS strings; mutable caller objects are rejected.

`paintPicture` snapshots caller-owned images/canvases/pixel arrays. String
sources reserve their command position before decoding. `setPicture` replaces
the background Picture; invalid new input does not cancel a valid pending
request. Repeated A/B/A requests have independent identities. `clear` cancels
command images but preserves the background Picture. Disposal settles pending
loads without unhandled rejections. Cross-origin images must be origin-clean.

`writePixels` is deliberately different: raw GDI RGBA bytes are made opaque,
and full-frame or repeated tail-rectangle writes replace rather than accumulate
previous bitmap commands. `readPixels` returns copied CSS-pixel RGBA bytes;
`point` returns an OLE_COLOR or -1 outside the surface. `flush` waits for owned
image loads and GPU initialization, then presents the current revision.
`toDataURL` and `toBlob` export the same retained image. `batch` only coalesces
scheduling; it is synchronous and is **not** a rollback transaction.

## Resource and lifecycle bounds

The public contract limits command count to 50,000, command metadata to 32 MiB,
retained command images to 32 MiB, each source/readback image to 4,194,304 pixels,
display backing to 16,777,216 pixels, dimensions to 8,192, path points to 16,384,
text to 1,048,576 UTF-16 units and state depth to 128. Readback/export requires
the logical surface to fit the readback pixel budget. Display DPR is bounded by
three, the device texture limit and the total display budget. Geometry outside
the viewport is clipped, and raster-operation scratch is bounded to the visible
command region before allocation. Integer designer grids use a small repeated
tile rather than millions of individual draw calls; very large fractional grids
fail with a diagnostic instead of monopolizing a frame.

Document transfer cancels the old window's frame requests and observers,
rebinds theme/font listeners, invalidates realm-dependent caches and recreates
only the surface's GPU resources. Late initialization and old-device loss
cannot attach to or destroy a replacement surface. Disposal is idempotent.

## Validation

```sh
npm run test:graphics
npm run test:graphics:browser                  # Real local HTTP origin
VB6_BROWSER=firefox npm run test:graphics:browser
VB6_BROWSER=webkit npm run test:graphics:browser
VB6_REQUIRE_GPU=1 npm run test:graphics:browser # Fails if real WebGPU unavailable
```

The graphics suite is owned by the existing three-engine controls CI group.
The required WebGPU rendering job also runs it in headed and headless modes at
DPR 1, 1.25 and 2. It reads back the actual GPU texture and compares every byte
with the ordered backing raster; GPU availability and uncaptured errors are
assertions, not skips. The tests also cover a real compiled VB program and
ApplicationHost, image decoding, raster truth tables, overpainting, clipping,
paths, state isolation, cached replay, GDI replacement and document adoption.

`VB6_TEST_TRANSPORT=memory` exists for restricted local environments, is recorded
in every report, and cannot be combined with required-GPU validation. It does
not certify HTTP/file loading, real secure-origin WebGPU, or another browser
engine. Existing validation assertions, timeouts and generated-artifact checks
are not relaxed by this suite.

## Remaining compatibility boundaries

This increment does **not** certify complete classic VB6 graphics compatibility.
In particular, native Windows edge coverage/font rasterization, Printer spooler
and PrintForm integration, full StdPicture/COM image objects, SavePicture's
native file-format behavior, AutoRedraw's complete native Paint/exposure
lifecycle, and the full Print statement formatting grammar remain separate
work. Direct Print method improvements do not imply support for every Tab/Spc,
semicolon or Print-zone formatting case. The browser still retains commands
rather than reproducing every native nonpersistent window-surface transition.

Extended Step/implicit-start/Circle-arc/Scale source syntax has an explicit
`graphicsExtended` IR instruction. Native Win32, macOS AOT and compute exports
currently reject it at compile time instead of silently discarding operands.
Their basic graphics implementations are separate and do not acquire all of
these browser semantics merely by using the shared source parser. The browser
Image getter is a PNG data URL, not an OLE StdPicture. Image format support is
that of the host browser decoder. Logical readback is the defined surface
contract; display antialiasing may vary by browser/font/DPR.

## Primary semantic references

These references describe the legacy contracts being adapted, not a claim
that the browser is a native VB6 or Access runtime:

- Microsoft VB6 compatibility: [PSet and DrawWidth](https://learn.microsoft.com/en-us/previous-versions/bb823218(v=vs.140)) and [DrawStyle](https://learn.microsoft.com/en-us/previous-versions/bb823113(v=vs.140)).
- Microsoft legacy [Circle](https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2003/aa221156(v=office.11)) and [DrawMode](https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2003/aa195856(v=office.11)).
- Microsoft VB6 compatibility [PaintPicture](https://learn.microsoft.com/en-us/previous-versions/bb918079(v=vs.140)) and [ScaleTop](https://learn.microsoft.com/en-us/previous-versions/bb882704(v=vs.140)).
