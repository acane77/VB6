import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMScene} from '../src/rendering/dom-scene.js';
import {PaintScene} from '../src/rendering/scene.js';
import {nativeTextBounds} from '../src/rendering/paint-bounds.js';
function adapter(rect, textShadow = 'none', scale = 1) {
  const scene = Object.create(DOMScene.prototype), parent = {};
  Object.assign(scene, {scene:new PaintScene(100,100), policy:{text:'native'},
    style:()=>({visibility:'visible',textShadow,direction:'ltr',textDecorationLine:'none',transform:'none'}),
    box:()=>({width:100,height:100,rect:[0,0,100*scale,100*scale]}),
    range:{selectNodeContents(){},getClientRects:()=>[{left:rect[0],top:rect[1],width:rect[2],height:rect[3]}]}});
  return {scene,node:{parentElement:parent,textContent:'native text'}};
}
test('native text shadows retain multiple offsets and blur without font reads',()=>{
  const rect=[20,20,40,20];
  assert.deepEqual(nativeTextBounds(rect,{textShadow:'red -10px -5px 3px, blue 20px 15px 0px'},[0,0,100,100]),[2,7,80,50]);
  const {scene,node}=adapter(rect,'red -10px -5px 3px, blue 20px 15px 0px');
  scene.text(node,scene.scene.clip);assert.deepEqual(scene.scene.commands[0].rect,[2,7,80,50]);
  assert.equal(scene.scene.stats.nativeText,1);
});
test('an offscreen glyph whose text shadow intersects the viewport is not culled',()=>{
  const {scene,node}=adapter([200,20,30,20],'black -150px 0px 0px');
  scene.text(node,scene.scene.clip);assert.equal(scene.scene.commands.length,1);
  assert.ok(scene.scene.commands[0].rect[0]<=50);assert.ok(scene.scene.commands[0].rect[0]+scene.scene.commands[0].rect[2]>=80);
});
test('text shadow bounds include inherited positive scaling',()=>{
  const {scene,node}=adapter([20,20,40,20],'black 10px 5px 0px',2);
  scene.text(node,scene.scene.clip);assert.deepEqual(scene.scene.commands[0].rect,[19,19,65,35]);
});
test('plain offscreen text remains a measurement-free early exit',()=>{
  const {scene,node}=adapter([200,20,30,20]);scene.box=()=>{throw Error('offscreen layout read')};
  scene.text(node,scene.scene.clip);assert.equal(scene.scene.commands.length,0);
});
test('native box shadows include inherited scaling even without an own transform',()=>{
  const {scene}=adapter([0,0,0,0]), node={tagName:'INPUT'};
  scene.style=()=>({transform:'none',boxShadow:'black 10px 5px 0px'});
  scene.box=()=>({width:20,height:10});
  scene.native(node,[20,20,40,20],scene.scene.clip,'native input');
  assert.deepEqual(scene.scene.commands[0].rect,[19,19,65,35]);
});
