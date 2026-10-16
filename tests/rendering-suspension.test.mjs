import test from 'node:test';
import assert from 'node:assert/strict';
import {UIRenderer, createPainter} from '../src/rendering/renderer.js';
import {CanvasPainter} from '../src/rendering/canvas2d.js';
import {PaintScene} from '../src/rendering/scene.js';
test('direct and forced renderNow calls do not measure or submit while hidden or printing',()=>{
  for(const state of [{printing:true,document:{hidden:false}},{printing:false,document:{hidden:true}}]){
    const renderer=Object.create(UIRenderer.prototype);
    Object.assign(renderer,{...state,driver:{},cancelFrame(){throw Error('unexpected frame work')},sceneFactory(){throw Error('unexpected layout')}});
    renderer.renderNow();renderer.renderNow({force:true});
  }
});
test('Canvas2D loss/restoration signals once and disposed contexts release all listeners',()=>{
  const events=new Map(),notices=[];
  const canvas={width:100,height:100,getContext:()=>({}),addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name,fn)=>{assert.equal(events.get(name),fn);events.delete(name)}};
  const painter=new CanvasPainter(canvas,{onLost:reason=>notices.push(reason),onRestored:()=>notices.push('restored')});
  const lost=events.get('contextlost'),restored=events.get('contextrestored');lost();lost();
  assert.deepEqual(notices,['Canvas2D context lost']);assert.throws(()=>painter.render(new PaintScene(10,10)),/context lost/);
  restored();restored();assert.deepEqual(notices,['Canvas2D context lost','restored']);
  painter.dispose();painter.dispose();lost();restored();assert.equal(notices.length,2);
  assert.equal(events.size,0);assert.equal(canvas.width,1);assert.equal(canvas.height,1);
});
test('Canvas2D factory forwards context loss to the ordinary renderer fallback hook',async()=>{
  let lost,seen;
  const painter=await createPainter('canvas2d',{getContext:()=>({}),addEventListener:(name,fn)=>{if(name==='contextlost')lost=fn}}, {onLost:reason=>seen=reason});
  lost();assert.equal(seen,'Canvas2D context lost');painter.dispose();
});
