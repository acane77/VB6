import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasTextStyle, applyCanvasTextStyle, normalizeTextRun} from '../src/rendering/text-style.js';
import {DOMScene} from '../src/rendering/dom-scene.js';
const context = () => ({fontKerning:'auto',fontStretch:'normal',fontVariantCaps:'normal',textRendering:'auto',letterSpacing:'0px',wordSpacing:'0px'});
test('CSS whitespace normalization preserves nonbreaking and intentional Unicode spaces', () => {
  assert.equal(normalizeTextRun('A\u00a0\u00a0B\u202fC\u2003D'), 'A\u00a0\u00a0B\u202fC\u2003D');
  assert.equal(normalizeTextRun('A\t \r\n\fB'), 'A B');
  assert.equal(normalizeTextRun('A   B', 'break-spaces'), 'A   B');
  assert.equal(normalizeTextRun('A   B', 'pre-wrap'), 'A   B');
  assert.equal(normalizeTextRun('A\tB', 'pre'), null); assert.equal(normalizeTextRun('A\nB', 'pre-line'), null);
  assert.equal(normalizeTextRun('a\u00adb'), null);
});
test('Canvas spacing and caps/stretches are normalized and feature detected', () => {
  const ctx=context(), style=canvasTextStyle({letterSpacing:'1.5px',wordSpacing:'3px',fontStretch:'75%',fontVariantCaps:'small-caps'},ctx);
  assert.equal(style.fontStretch,'condensed');applyCanvasTextStyle(ctx,style);
  assert.equal(ctx.letterSpacing,'1.5px');assert.equal(ctx.wordSpacing,'3px');assert.equal(ctx.fontVariantCaps,'small-caps');
  assert.equal(canvasTextStyle({letterSpacing:'1px'},{}),null);
  assert.equal(canvasTextStyle({wordSpacing:'2px'},{}),null);
  assert.ok(canvasTextStyle({letterSpacing:'normal',fontStretch:'100%'},{}));
  assert.equal(canvasTextStyle({fontStretch:'77%'},ctx),null);
  assert.equal(canvasTextStyle({wordSpacing:'calc(1px + 2px)'},ctx),null);
});
test('unsupported CSS shaping and transformation rules remain explicitly native', () => {
  for(const style of [{textTransform:'uppercase'},{textAlign:'justify'},{hyphens:'auto'},{fontFeatureSettings:'"ss01"'},
    {fontVariationSettings:'"wght" 550'},{fontVariantNumeric:'tabular-nums'},{fontVariantLigatures:'none'},
    {fontVariantEastAsian:'ruby'},{fontVariantPosition:'super'},{fontOpticalSizing:'none'}]) {
    assert.equal(canvasTextStyle(style,context()),null,JSON.stringify(style));
  }
});
test('changing text styles resets context state rather than leaking prior run spacing', () => {
  const ctx=context();applyCanvasTextStyle(ctx,canvasTextStyle({wordSpacing:'5px',fontVariantCaps:'small-caps'},ctx));
  applyCanvasTextStyle(ctx,canvasTextStyle({},ctx));assert.deepEqual(ctx,context());
});
test('offscreen text runs neither allocate atlas pixels nor create native holes', () => {
  const scene=Object.create(DOMScene.prototype);let atlasCalls=0;
  Object.assign(scene,{style:()=>({visibility:'visible'}),range:{selectNodeContents(){},getClientRects:()=>[{left:200,top:200,width:100,height:20}]},
    atlas:{text(){atlasCalls++;throw Error('offscreen')}},scene:{native(){throw Error('offscreen')},stats:{}}});
  scene.text({parentElement:{},textContent:'offscreen'},[0,0,100,100]);assert.equal(atlasCalls,0);
});
