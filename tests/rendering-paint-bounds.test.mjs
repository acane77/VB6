import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePaintBounds} from '../src/rendering/paint-bounds.js';
import {roundedRadii,preserveRoundedCorners} from '../src/rendering/rounded-corners.js';
import {PaintScene} from '../src/rendering/scene.js';
const clip=[0,0,1000,800],rect=[100,100,200,80];
test('multiple large shadows include blur, spread and positive/negative offsets',()=>{
  const bounds=nativePaintBounds(rect,{boxShadow:'rgba(0, 0, 0, 0.5) 30px 40px 20px 5px, rgb(0, 0, 0) -60px -20px 10px 0px'},clip);
  assert.deepEqual(bounds,[18,58,359,209]);
});
test('inset shadows do not enlarge bounds, outlines include offsets, and scaled lengths resolve',()=>{
  assert.deepEqual(nativePaintBounds(rect,{boxShadow:'rgb(0, 0, 0) 0px 0px 99px inset'},clip),[99,99,202,82]);
  assert.deepEqual(nativePaintBounds(rect,{outlineStyle:'solid',outlineWidth:'5px',outlineOffset:'20px'},clip),[72,72,256,136]);
  assert.deepEqual(nativePaintBounds(rect,{boxShadow:'#000 20px 10px 0px'},clip,2,3),[99,99,245,117]);
});
test('unknown filter or shadow geometry preserves the complete clip',()=>{
  for(const style of [{filter:'drop-shadow(5px 6px 20px black)'},{boxShadow:'rgb(0,0,0) calc(1px + 2px) 3px'}])
    assert.deepEqual(nativePaintBounds(rect,style,clip),clip);
});
const all=value=>Object.fromEntries(['TopLeft','TopRight','BottomRight','BottomLeft'].map(side=>['border'+side+'Radius',value]));
test('elliptical percentage radii use the CSS common overlap factor before transform',()=>{
  assert.deepEqual(roundedRadii(all('75% 100%'),200,100),[[75,50],[75,50],[75,50],[75,50]]);
  assert.deepEqual(roundedRadii(all('20px 10px'),200,100,2,3),[[40,30],[40,30],[40,30],[40,30]]);
  assert.deepEqual(roundedRadii(all('0px 20px'),200,100),[[0,0],[0,0],[0,0],[0,0]]);
  assert.throws(()=>roundedRadii(all('calc(10px + 2px)'),200,100),TypeError);
});
test('rounded preservation covers all four corners but leaves the GPU interior intact',()=>{
  const scene=new PaintScene(1000,800,{dpr:2});
  assert.equal(preserveRoundedCorners(scene,rect,roundedRadii(all('12px'),200,80),clip),4);
  for(const command of scene.commands){assert.ok(command.hole);assert.ok(command.rect[2]<20);assert.ok(command.rect[3]<20);}
  assert.equal(scene.stats.roundedCornerIslands,4);
  assert.deepEqual(scene.commands[0].rect,[99,99,14,14]);
  assert.deepEqual(scene.commands[2].rect,[287,167,14,14]);
});
test('thick borders expand the native corner transition rather than clipping it',()=>{
  const scene=new PaintScene(1000,800,{dpr:1});
  preserveRoundedCorners(scene,rect,roundedRadii(all('3px'),200,80),clip,[20,30,10,40]);
  assert.deepEqual(scene.commands[0].rect,[98,98,44,24]);
});
