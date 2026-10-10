import test from 'node:test';
import assert from 'node:assert/strict';
import { TurtleGraphics, SpriteManager, VdpDisplay, PALETTE } from '../src/core/graphics.js';
import { patternContours, LogoScene } from '../src/rendering/scene.js';
import { semanticSamplerParts, semanticSamplerTileParts } from '../src/rendering/artwork.js';
import { SAMPLERS } from '../src/data/samplers.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);

test('turtle retains native north-facing coordinates, unclipped vectors, and pen state', () => {
  const turtle = new TurtleGraphics();
  turtle.forward(100); turtle.right(90); turtle.forward(50);
  close(turtle.x,50); close(turtle.y,100); assert.equal(turtle.lines.length,2);
  turtle.penUp(); turtle.back(20); turtle.setY(-20);
  assert.equal(turtle.lines.length,2); close(turtle.x,30); close(turtle.y,-20);
  turtle.setHeading(-450); assert.equal(turtle.heading,270);
  close(turtle.towards(30,10),0); close(turtle.towards(50,-20),90);
  turtle.penDownCommand(); turtle.setX(-12);
  assert.deepEqual(turtle.lines[2],{x1:30,y1:-20,x2:-12,y2:-20,color:1});
  turtle.clean(); assert.equal(turtle.lines.length,0); close(turtle.x,-12);
  turtle.clearScreen(); close(turtle.x,0); close(turtle.y,0); close(turtle.heading,0);
});

test('sprite selection, priority IDs, visibility, headings, and toroidal motion match native behavior', () => {
  const sprites = new SpriteManager();
  assert.equal(sprites.sprites.length,32); assert.deepEqual(sprites.selected,[0]);
  sprites.tell([0,3,31,-1,32]); sprites.setCarry(4); sprites.setHeading(90); sprites.setSpeed(10); sprites.setColor(6);
  sprites.updateMotion(1);
  close(sprites.getSprite(0).x,10); close(sprites.getSprite(3).x,10); close(sprites.getSprite(31).x,10);
  assert.equal(sprites.getSprite(2).visible,false);
  sprites.tell(0); sprites.setXY(125,0); sprites.updateMotion(1); close(sprites.getSprite(0).x,-121);
  sprites.setSpeed(1024); sprites.updateMotion(1); close(sprites.getSprite(0).x,-121);
  sprites.hide(); sprites.updateMotion(1); close(sprites.getSprite(0).x,-121);
  sprites.setColor(20); assert.equal(sprites.getSprite(0).color,6);
});

test('separate x/y velocities compose and speed restores heading-driven movement', () => {
  const sprites = new SpriteManager();
  sprites.setCarry(2); sprites.setXVelocity(20); sprites.setYVelocity(-10);
  sprites.updateMotion(0.5); close(sprites.getSprite(0).x,10); close(sprites.getSprite(0).y,-5);
  sprites.setHeading(0); sprites.setSpeed(2); sprites.updateMotion(0.5);
  close(sprites.getSprite(0).x,10); close(sprites.getSprite(0).y,-4);
});

test('tile coordinates, color pairs, and saved patterns are independent of browser resolution', () => {
  const display = new VdpDisplay();
  assert.equal(display.width,256); assert.equal(display.height,192); assert.equal(PALETTE.length,16);
  display.putTile(216,31,23); display.putTile(99,32,23);
  assert.equal(display.getTile(31,23),216); assert.equal(display.getTile(32,23),0);
  display.setCharacterPattern(90,[1,2,3,4,5,6,7,8]); display.setTileColor(90,[7,4]);
  assert.equal(display.getTileColor(90),7); assert.equal(display.tileBackgrounds[90],4);
  display.setBackgroundColor(4); assert.equal(display.backgroundColor,4); assert.equal(display.backgroundExplicit,true);
  display.placeCharacter(90); assert.equal(display.getTile(0,0),90); assert.equal(display.characterCursor,1);
});

test('graphics snapshots round-trip vectors, selections, editable patterns, and palette state', () => {
  const turtle = new TurtleGraphics(); turtle.forward(15); turtle.hide();
  const sprites = new SpriteManager(); sprites.tell([1,31]); sprites.setCarry(44); sprites.setXVelocity(2); sprites.defineShape(44,Array(32).fill(127));
  const display = new VdpDisplay(); display.setBackgroundColor(15); display.putTile(216,2,3);
  for (const model of [turtle,sprites,display]) {
    const snapshot = JSON.parse(JSON.stringify(model.snapshot()));
    model.reset(); model.restore(snapshot); assert.deepEqual(model.snapshot(),snapshot);
  }
});

test('resetPatterns restores built-in resources after loading an artwork sampler', () => {
  const sprites = new SpriteManager(); sprites.defineShape(1,Array(32).fill(0)); sprites.resetPatterns();
  assert.equal(sprites.patterns.get(1).custom,false); assert.ok(sprites.getShapePattern(1).some(Boolean));
  const display = new VdpDisplay(); display.setCharacterPattern(216,Array(8).fill(0)); display.resetPatterns();
  assert.equal(display.getCharacterPattern(216)[0],255);
});

test('vector contour conversion retains disconnected regions and negative-space holes', () => {
  const ring = [255,129,129,129,129,129,129,255];
  const contours = patternContours(ring,8); assert.equal(contours.length,2);
  const area = (points) => points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
  assert.ok(area(contours[0]) * area(contours[1]) < 0);
  assert.equal(patternContours([128,0,0,0,0,0,0,1],8).length,2);
  assert.equal(patternContours(Array(32).fill(0)).length,0);
  assert.ok(contours[0].some(([x,y]) => !Number.isInteger(x) || !Number.isInteger(y)));
});

test('SVG export includes vector strokes, tiles and sprite shapes without raster assets', () => {
  const turtle = new TurtleGraphics(); turtle.forward(10);
  const sprites = new SpriteManager(); sprites.setCarry(4);
  const display = new VdpDisplay(); display.putTile(216,1,1);
  const scene = Object.create(LogoScene.prototype);
  Object.assign(scene,{turtle,sprites,display,gridVisible:true,contourCache:new Map()});
  const svg=scene.exportSVG();
  assert.match(svg,/<svg/); assert.match(svg,/stroke-linecap="round"/); assert.match(svg,/clip-path="url\(#frame\)"/);
  assert.doesNotMatch(svg,/<image|data:image|\.png|\.bin|\.wasm/);
});

test('untouched sampler resources use curved artwork, and editing one byte restores custom rendering', () => {
  for(const [samplerId,id] of [['A_FROG',16],['A_FISH',11],['A_ELEPHANT',13],['A_HORSE',16],['A_SPRING',10]]){
    const sampler=SAMPLERS.find(s=>s.id===samplerId),data=sampler.spritePatterns.slice(id*32,id*32+32);
    const parts=semanticSamplerParts(samplerId,id,data,'#39ce7c');
    assert.ok(parts?.length,`${samplerId} shape ${id} has an illustration`);
    assert.ok(parts.some(({shape})=>shape.curves.some(curve=>curve.type!=='LineCurve')),`${samplerId} includes smooth curves`);
    data[0]^=1;
    assert.equal(semanticSamplerParts(samplerId,id,data,'#39ce7c'),null);
  }
});

test('multipart animals retain original sprite centers and tile edits bypass semantic artwork', () => {
  const sampler=SAMPLERS.find(s=>s.id==='A_FROG');
  for(const id of [6,7,8,9,10,11,12,13]){
    const parts=semanticSamplerParts(sampler.id,id,sampler.spritePatterns.slice(id*32,id*32+32),'#39ce7c');
    assert.ok(parts.length);
    for(const {shape} of parts)for(const point of shape.getPoints(24)){
      assert.ok(point.x>=-8.001&&point.x<=8.001&&point.y>=-8.001&&point.y<=8.001);
    }
  }
  const pond=sampler.characterPatterns.slice(800,808);
  assert.ok(semanticSamplerTileParts(sampler.id,100,pond,'#63dce5',{col:4,row:15}).length);
  pond[0]^=1;assert.equal(semanticSamplerTileParts(sampler.id,100,pond,'#63dce5',{col:4,row:15}),null);
});
