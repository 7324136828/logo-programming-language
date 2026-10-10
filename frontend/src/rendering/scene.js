import * as THREE from 'three';
import { PALETTE, WIDTH, HEIGHT } from '../core/graphics.js';
import { semanticSamplerParts, semanticSamplerTileParts, isOriginalSamplerPattern } from './artwork.js';

const CHARCOAL = '#111923';
const DEGREES = Math.PI / 180;
const modernColors = ['#000000','#e9eff7','#39ce7c','#8ce3a3','#6584ff','#a298ff','#d45d65','#63dce5','#ff6d76','#ffabb1','#d6b851','#efdb94','#239c64','#ce83d9','#a5b1c1','#ffffff'];
function brightness(hex) {
  const value = parseInt(hex.slice(1), 16);
  return ((value >> 16) * 0.2126 + ((value >> 8) & 255) * 0.7152 + (value & 255) * 0.0722) / 255;
}
function disposeGroup(group) {
  for (const object of [...group.children]) {
    object.traverse((child) => { child.geometry?.dispose(); if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose()); else child.material?.dispose(); });
    group.remove(object);
  }
}
function smooth(points, rounds = 2) {
  for (let iteration = 0; iteration < rounds; iteration++) {
    const next = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]; const b = points[(i + 1) % points.length];
      const fraction = Math.min(0.25, 0.35 / Math.hypot(b[0] - a[0], b[1] - a[1]));
      next.push([a[0] * (1-fraction) + b[0] * fraction, a[1] * (1-fraction) + b[1] * fraction], [a[0] * fraction + b[0] * (1-fraction), a[1] * fraction + b[1] * (1-fraction)]);
    }
    points = next;
  }
  return points;
}

/** Trace solid regions, retaining holes. Bytes become vector outlines, never pixel quads. */
export function patternContours(data, size = 16) {
  const filled = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    const index = size === 16 ? y + (x >= 8 ? 16 : 0) : y;
    return Boolean((data[index] ?? 0) & (128 >> (x % 8)));
  };
  const edges = new Map();
  const key = (x, y) => `${x},${y}`;
  const add = (a, b) => { const index = key(...a); if (!edges.has(index)) edges.set(index, []); edges.get(index).push(b); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!filled(x, y)) continue;
    if (!filled(x, y - 1)) add([x, y], [x + 1, y]);
    if (!filled(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
    if (!filled(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
    if (!filled(x - 1, y)) add([x, y + 1], [x, y]);
  }
  const loops = [];
  while (edges.size) {
    const startKey = edges.keys().next().value; const start = startKey.split(',').map(Number);
    const points = []; let current = start; let previous = [start[0] - 1, start[1]];
    for (let n = 0; n <= size * size * 4; n++) {
      const candidates = edges.get(key(...current)); if (!candidates?.length) break;
      points.push(current);
      // At diagonal contacts choose the right turn so disconnected regions stay separate.
      const direction = [current[0] - previous[0], current[1] - previous[1]];
      let chosen = 0; let best = -Infinity;
      candidates.forEach((point, index) => {
        const next = [point[0] - current[0], point[1] - current[1]];
        const turn = direction[0] * next[1] - direction[1] * next[0];
        const score = turn === 1 ? 3 : turn === 0 ? 2 : 1;
        if (score > best) { best = score; chosen = index; }
      });
      const [next] = candidates.splice(chosen, 1);
      if (!candidates.length) edges.delete(key(...current));
      previous = current; current = next;
      if (key(...current) === startKey) break;
    }
    if (points.length > 2) {
      const corners = points.filter((b, i) => {
        const a = points[(i + points.length - 1) % points.length]; const c = points[(i + 1) % points.length];
        return (b[0] - a[0]) * (c[1] - b[1]) !== (b[1] - a[1]) * (c[0] - b[0]);
      });
      loops.push(smooth(corners.length >= 3 ? corners : points).map(([x, y]) => [x - size / 2, size / 2 - y]));
    }
  }
  return loops;
}
function area(points) { return points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2; }
function contains(points, point) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]; const b = points[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function polygon(points, Type = THREE.Shape) {
  const shape = new Type(); shape.moveTo(...points[0]);
  for (const point of points.slice(1)) shape.lineTo(...point);
  shape.closePath(); return shape;
}
function contourShapes(loops) {
  const outer = loops.filter((loop) => area(loop) < 0);
  const holes = loops.filter((loop) => area(loop) > 0);
  return outer.map((loop) => {
    const shape = polygon(loop);
    for (const hole of holes) {
      if (contains(loop, hole[0]) && !outer.some((other) => other !== loop && Math.abs(area(other)) < Math.abs(area(loop)) && contains(other, hole[0]))) shape.holes.push(polygon(hole, THREE.Path));
    }
    return shape;
  });
}
function ellipse(x, y, rx, ry = rx) {
  const shape = new THREE.Shape(); shape.absellipse(x, y, rx, ry, 0, Math.PI * 2, false); return shape;
}
function roundedRect(x, y, width, height, radius = 1) {
  const shape = new THREE.Shape(); const r = Math.min(radius, width / 2, height / 2);
  shape.moveTo(x + r, y); shape.lineTo(x + width - r, y); shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r); shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y); return shape;
}
function builtinParts(id, color) {
  const highlight = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.34).getStyle();
  const dark = new THREE.Color(color).lerp(new THREE.Color('#101924'), 0.62).getStyle();
  const body = (shape, fill = color) => ({ shape, fill });
  if (id === 1) return [body(polygon([[0,8],[1.25,6],[1.25,1],[7,-3],[7,-4],[1.15,-2],[1,-5],[3,-6.5],[3,-7.5],[0,-6.4],[-3,-7.5],[-3,-6.5],[-1,-5],[-1.15,-2],[-7,-4],[-7,-3],[-1.25,1],[-1.25,6]])),body(ellipse(0,3,0.65,2),highlight)];
  if (id === 2) return [body(roundedRect(-8,-3,10,9,1.2)),body(polygon([[2,-3],[8,-3],[8,1],[5.5,4],[2,4]])),body(roundedRect(3,0,2.5,2.5,0.45),highlight),body(ellipse(-4,-3,2.15),dark),body(ellipse(5,-3,2.15),dark),body(ellipse(-4,-3,0.8),highlight),body(ellipse(5,-3,0.8),highlight)];
  if (id === 3) {
    const shape = new THREE.Shape(); shape.moveTo(0,8); shape.bezierCurveTo(5,4,4,-2,3,-5); shape.lineTo(-3,-5); shape.bezierCurveTo(-4,-2,-5,4,0,8);
    return [body(polygon([[-3,-1],[-7,-6],[-3,-5]]),dark),body(polygon([[3,-1],[7,-6],[3,-5]]),dark),body(polygon([[-2,-5],[0,-8],[2,-5]]),'#f6c45f'),body(shape),body(ellipse(0,2,1.8),highlight),body(ellipse(0,2,1.05),dark)];
  }
  if (id === 4) return [body(ellipse(0,0,7)),body(ellipse(-2.1,2.5,2.1,1.4),highlight)];
  if (id === 5) {
    const shape = roundedRect(-7.5,-7.5,15,15,2); shape.holes.push(roundedRect(-6,-6,12,12,0.9));
    return [body(shape),body(roundedRect(-2.5,-7.1,5,1,0.5),highlight)];
  }
  return [];
}
function turtleParts(color) {
  return [
    ...[[-3.4,3.5],[3.4,3.5],[-3.1,-3.5],[3.1,-3.5]].map(([x,y]) => ({ shape: ellipse(x,y,1.5,2), fill: color })),
    { shape: ellipse(0,5.6,2.1,2.5), fill: color }, { shape: polygon([[-1,-4],[0,-6.8],[1,-4]]), fill: color },
    { shape: ellipse(0,0,3.75,5), fill: color },
    { shape: ellipse(0,0,2.65,3.55), fill: new THREE.Color(color).lerp(new THREE.Color('#102328'),0.3).getStyle() },
    { shape: polygon([[-1.35,1.05],[0,2],[1.35,1.05],[1.35,-1.05],[0,-2],[-1.35,-1.05]]), fill: color },
    { shape: ellipse(-0.8,6.5,0.33), fill: '#12252a' }, { shape: ellipse(0.8,6.5,0.33), fill: '#12252a' },
  ];
}
const loopPath = (points) => `${points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('')}Z`;
function shapePath(shape) { return [shape, ...shape.holes].map((path) => loopPath(path.getPoints(24))).join(''); }
function partMarkup(parts) { return parts.map(({shape,fill}) => `<path d="${shapePath(shape)}" fill="${fill}" fill-rule="evenodd"/>`).join(''); }

export class LogoScene {
  constructor(host, models) {
    this.host = host; Object.assign(this, models); this.gridVisible = true;
    this.scene = new THREE.Scene(); this.camera = new THREE.OrthographicCamera(-128,128,96,-96,0.1,100);
    this.camera.position.z = 50;
    this.tilesLayer = new THREE.Group(); this.linesLayer = new THREE.Group(); this.spritesLayer = new THREE.Group(); this.turtleLayer = new THREE.Group(); this.gridLayer = new THREE.Group();
    this.scene.add(this.gridLayer,this.tilesLayer,this.linesLayer,this.spritesLayer,this.turtleLayer);
    this.spriteNodes = new Map(); this.contourCache = new Map(); this.artworkCache = new Map();
    this.canvas = document.createElement('canvas'); this.canvas.setAttribute('aria-label','Logo drawing canvas'); this.canvas.setAttribute('role','img');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;';
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3)); this.backend = 'Three.js / WebGL';
    } catch {
      this.canvas = document.createElement('canvas'); this.canvas.setAttribute('aria-label','Logo drawing canvas'); this.canvas.setAttribute('role','img');
      this.canvas.style.cssText = 'display:block;width:100%;height:100%;'; this.ctx = this.canvas.getContext('2d'); this.backend = 'Canvas vector fallback';
    }
    host.replaceChildren(this.canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host); this.resize();
  }
  get background() { return this.display.backgroundExplicit ? (modernColors[this.display.backgroundColor] ?? CHARCOAL) : CHARCOAL; }
  ink(index) { return index === 1 ? (brightness(this.background) < 0.45 ? '#dbe6f1' : '#182432') : (modernColors[index] ?? PALETTE[1]); }
  get cursorColor() { return this.turtle.color === 1 ? '#8be4bc' : this.ink(this.turtle.color); }
  resize() {
    const width = Math.max(1,this.host.clientWidth); const height = Math.max(1,this.host.clientHeight);
    this.width = width; this.height = height; this.scale = Math.min(width / WIDTH,height / HEIGHT);
    this.offsetX = (width - WIDTH * this.scale) / 2; this.offsetY = (height - HEIGHT * this.scale) / 2;
    if (this.renderer) {
      this.renderer.setSize(width,height,false); const worldWidth = width / this.scale; const worldHeight = height / this.scale;
      Object.assign(this.camera,{ left: -worldWidth / 2, right: worldWidth / 2, top: worldHeight / 2, bottom: -worldHeight / 2 }); this.camera.updateProjectionMatrix();
    } else {
      const dpr = Math.min(window.devicePixelRatio || 1,3); this.canvas.width = Math.round(width*dpr); this.canvas.height = Math.round(height*dpr); this.dpr = dpr;
    }
    this.render();
  }
  setGrid(visible) { this.gridVisible = Boolean(visible); this.gridLayer.visible = this.gridVisible; this.render(); }
  addParts(group,parts,z = 0,order = 0) {
    parts.forEach(({shape,fill},i) => {
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape,24),new THREE.MeshBasicMaterial({ color: fill,depthTest: false,depthWrite: false,side: THREE.DoubleSide }));
      mesh.position.z = z + i * 0.001; mesh.renderOrder = order + i * 0.001; group.add(mesh);
    });
  }
  addBatchedTiles() {
    const batches=new Map();
    this.display.tiles.forEach((id,index)=>{
      if(!id)return;
      const x=index%32*8-124,y=92-Math.floor(index/32)*8;
      this.tileParts(id,index%32,Math.floor(index/32)).forEach(({shape,fill},layer)=>{
        const key=`${layer}:${fill}`;
        if(!batches.has(key))batches.set(key,{fill,layer,vertices:[]});
        const vertices=batches.get(key).vertices;
        const indexed=new THREE.ShapeGeometry(shape,24),geometry=indexed.toNonIndexed(),positions=geometry.attributes.position;
        for(let point=0;point<positions.count;point++)vertices.push(positions.getX(point)+x,positions.getY(point)+y,0);
        indexed.dispose();geometry.dispose();
      });
    });
    for(const {fill,layer,vertices} of batches.values()){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:fill,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
      mesh.renderOrder=1+layer*.001;this.tilesLayer.add(mesh);
    }
  }
  contours(data,size,key) {
    if (!this.contourCache.has(key)) this.contourCache.set(key,contourShapes(patternContours(data,size)));
    return this.contourCache.get(key);
  }
  spriteParts(sprite) {
    const pattern = this.sprites.patterns.get(sprite.shape); const color = this.ink(sprite.color);
    if(pattern?.custom){
      const key=`sprite:${this.sprites.samplerId}:${this.sprites.patternRevision}:${sprite.shape}:${color}`;
      if(!this.artworkCache)this.artworkCache=new Map();
      if(!this.artworkCache.has(key))this.artworkCache.set(key,semanticSamplerParts(this.sprites.samplerId,sprite.shape,pattern.data,color));
      const parts=this.artworkCache.get(key);if(parts)return parts;
      if(sprite.shape>=1&&sprite.shape<=5&&isOriginalSamplerPattern(this.sprites.samplerId,sprite.shape,pattern.data))return builtinParts(sprite.shape,color);
    }
    if (pattern?.custom) return this.contours(pattern.data,16,`s${this.sprites.patternRevision}:${sprite.shape}`).map((shape) => ({shape,fill:color}));
    return builtinParts(sprite.shape,color);
  }
  tileParts(id,col=0,row=0) {
    const result = []; const bg = this.display.tileBackgrounds[id];
    const key=`tile:${this.display.samplerId}:${this.display.revision}:${id}:${col}:${row}`;
    if(!this.artworkCache)this.artworkCache=new Map();
    if(!this.artworkCache.has(key))this.artworkCache.set(key,semanticSamplerTileParts(this.display.samplerId,id,this.display.patterns.get(id),this.ink(this.display.colors[id]),{col,row}));
    const illustrated=this.artworkCache.get(key);if(illustrated)return this.display.colors[id]?illustrated:[];
    if (bg) result.push({shape:roundedRect(-4,-4,8,8,0),fill:this.ink(bg)});
    if (this.display.colors[id]) {
      const data = this.display.patterns.get(id);
      if (data) result.push(...this.contours(data,8,`t${this.display.revision}:${id}`).map((shape) => ({shape,fill:this.ink(this.display.colors[id])})));
    }
    return result;
  }
  syncStaticLayers() {
    const backgroundChanged = this.lastBackground !== this.background;
    if (this.lastPatterns!==this.sprites.patternRevision) { this.lastPatterns=this.sprites.patternRevision; this.contourCache.clear(); this.artworkCache.clear(); }
    if (backgroundChanged) { this.lastBackground = this.background; this.contourCache.clear(); this.artworkCache.clear(); }
    if (backgroundChanged || this.lastTiles !== this.display.revision) {
      this.lastTiles = this.display.revision; disposeGroup(this.tilesLayer); this.contourCache.clear(); this.artworkCache.clear();
      this.addBatchedTiles();
    }
    if (backgroundChanged || this.lastLines !== this.turtle.revision) {
      this.lastLines = this.turtle.revision; disposeGroup(this.linesLayer);
      let color = null; let vertices = []; let order = 2;
      const flush = () => {
        if (!vertices.length) return;
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
        const mesh = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:this.ink(color),depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
        mesh.renderOrder = 2 + (order++ * 0.000001); this.linesLayer.add(mesh); vertices = [];
      };
      for (const line of this.turtle.lines) {
        if (line.color !== color || vertices.length > 120000) { flush(); color = line.color; }
        if (!line.color) continue;
        const dx = line.x2-line.x1; const dy = line.y2-line.y1; const length = Math.hypot(dx,dy); const radius = 0.34;
        if (length) {
          const px = -dy/length*radius; const py = dx/length*radius;
          vertices.push(line.x1+px,line.y1+py,0,line.x1-px,line.y1-py,0,line.x2+px,line.y2+py,0,line.x2+px,line.y2+py,0,line.x1-px,line.y1-py,0,line.x2-px,line.y2-py,0);
        }
        for (const [x,y] of [[line.x1,line.y1],[line.x2,line.y2]]) for (let i=0;i<12;i++) {
          const a=i/12*Math.PI*2; const b=(i+1)/12*Math.PI*2;
          vertices.push(x,y,0,x+radius*Math.cos(a),y+radius*Math.sin(a),0,x+radius*Math.cos(b),y+radius*Math.sin(b),0);
        }
      }
      flush();
    }
    if (backgroundChanged || !this.gridLayer.children.length) {
      disposeGroup(this.gridLayer); const dots=[];
      for (let x=-120;x<=120;x+=16) for (let y=-88;y<=88;y+=16) dots.push(x,y,0);
      const geometry=new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(dots,3));
      const material=new THREE.PointsMaterial({color:brightness(this.background)<0.45?'#263543':'#344456',size:0.7,sizeAttenuation:true,depthTest:false,depthWrite:false});
      const points=new THREE.Points(geometry,material); points.renderOrder=0; this.gridLayer.add(points);
    }
  }
  render() {
    if (!this.canvas || !this.width) return;
    if (!this.renderer) { this.renderCanvas(); return; }
    this.syncStaticLayers();
    for (const sprite of this.sprites.sprites) {
      let node=this.spriteNodes.get(sprite.id); const key=`${this.sprites.samplerId}:${sprite.shape}:${sprite.color}:${this.sprites.patternRevision}:${this.background}`;
      if (!node) { node=new THREE.Group(); this.spriteNodes.set(sprite.id,node); this.spritesLayer.add(node); }
      node.visible=sprite.visible && sprite.color!==0;
      if (node.visible && node.userData.key!==key) { disposeGroup(node); this.addParts(node,this.spriteParts(sprite),0,1000+(31-sprite.id)*2); node.userData.key=key; }
      node.position.set(sprite.x,sprite.y,5);
      // Custom patterns are pre-oriented multipart artwork. Only built-ins rotate.
      node.rotation.z=this.sprites.patterns.get(sprite.shape)?.custom?0:-sprite.heading*DEGREES;
    }
    const cursorKey=this.cursorColor;
    if (this.lastCursor!==cursorKey) { disposeGroup(this.turtleLayer); this.addParts(this.turtleLayer,turtleParts(cursorKey),0,1200); this.lastCursor=cursorKey; }
    this.turtleLayer.visible=this.turtle.visible; this.turtleLayer.position.set(this.turtle.x,this.turtle.y,10); this.turtleLayer.rotation.z=-this.turtle.heading*DEGREES;
    this.gridLayer.visible=this.gridVisible; this.renderer.setClearColor(this.background);
    this.renderer.setScissorTest(false); this.renderer.clear();
    this.renderer.setScissor(this.offsetX,this.offsetY,WIDTH*this.scale,HEIGHT*this.scale); this.renderer.setScissorTest(true);
    this.renderer.render(this.scene,this.camera); this.renderer.setScissorTest(false);
  }
  drawCanvasParts(parts) {
    for (const {shape,fill} of parts) { this.ctx.fillStyle=fill; this.ctx.fill(new Path2D(shapePath(shape)),'evenodd'); }
  }
  renderCanvas() {
    const ctx=this.ctx; if (!ctx) return;
    if (this.lastTiles!==this.display.revision || this.lastPatterns!==this.sprites.patternRevision) {
      this.contourCache.clear(); this.artworkCache.clear(); this.lastTiles=this.display.revision; this.lastPatterns=this.sprites.patternRevision;
    }
    ctx.setTransform(this.dpr,0,0,this.dpr,0,0); ctx.fillStyle=this.background; ctx.fillRect(0,0,this.width,this.height);
    ctx.save(); ctx.translate(this.width/2,this.height/2); ctx.scale(this.scale,-this.scale); ctx.beginPath(); ctx.rect(-128,-96,256,192); ctx.clip();
    if (this.gridVisible) {
      ctx.fillStyle=brightness(this.background)<0.45?'#344456':'#000000'; ctx.globalAlpha=0.55;
      for (let x=-120;x<=120;x+=16) for (let y=-88;y<=88;y+=16) {ctx.beginPath();ctx.arc(x,y,0.25,0,Math.PI*2);ctx.fill();}
      ctx.globalAlpha=1;
    }
    this.display.tiles.forEach((id,index)=>{if(id){ctx.save();ctx.translate(index%32*8-124,92-Math.floor(index/32)*8);this.drawCanvasParts(this.tileParts(id,index%32,Math.floor(index/32)));ctx.restore();}});
    ctx.lineWidth=0.68;ctx.lineCap='round';ctx.lineJoin='round';
    for(const line of this.turtle.lines){if(!line.color)continue;ctx.strokeStyle=this.ink(line.color);ctx.beginPath();ctx.moveTo(line.x1,line.y1);ctx.lineTo(line.x2,line.y2);ctx.stroke();}
    for(const sprite of [...this.sprites.sprites].reverse())if(sprite.visible&&sprite.color){ctx.save();ctx.translate(sprite.x,sprite.y);if(!this.sprites.patterns.get(sprite.shape)?.custom)ctx.rotate(-sprite.heading*DEGREES);this.drawCanvasParts(this.spriteParts(sprite));ctx.restore();}
    if(this.turtle.visible){ctx.save();ctx.translate(this.turtle.x,this.turtle.y);ctx.rotate(-this.turtle.heading*DEGREES);this.drawCanvasParts(turtleParts(this.cursorColor));ctx.restore();}
    ctx.restore();
  }
  exportPNG() { this.render(); return this.canvas.toDataURL('image/png'); }
  exportSVG() {
    let content='';
    if(this.gridVisible)for(let x=-120;x<=120;x+=16)for(let y=-88;y<=88;y+=16)content+=`<circle cx="${x}" cy="${y}" r=".25" fill="#344456"/>`;
    this.display.tiles.forEach((id,index)=>{if(id)content+=`<g transform="translate(${index%32*8-124} ${92-Math.floor(index/32)*8})">${partMarkup(this.tileParts(id,index%32,Math.floor(index/32)))}</g>`;});
    for(const l of this.turtle.lines)if(l.color)content+=`<path d="M${l.x1},${l.y1}L${l.x2},${l.y2}" fill="none" stroke="${this.ink(l.color)}" stroke-width=".68" stroke-linecap="round"/>`;
    for(const s of [...this.sprites.sprites].reverse())if(s.visible&&s.color)content+=`<g transform="translate(${s.x} ${s.y}) rotate(${this.sprites.patterns.get(s.shape)?.custom?0:-s.heading})">${partMarkup(this.spriteParts(s))}</g>`;
    if(this.turtle.visible)content+=`<g transform="translate(${this.turtle.x} ${this.turtle.y}) rotate(${-this.turtle.heading})">${partMarkup(turtleParts(this.cursorColor))}</g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 192" width="1024" height="768"><rect width="256" height="192" fill="${this.background}"/><defs><clipPath id="frame"><rect x="-128" y="-96" width="256" height="192"/></clipPath></defs><g transform="translate(128 96) scale(1 -1)" clip-path="url(#frame)">${content}</g></svg>`;
  }
  dispose() {
    this.resizeObserver.disconnect(); [this.gridLayer,this.tilesLayer,this.linesLayer,this.spritesLayer,this.turtleLayer].forEach(disposeGroup);
    this.renderer?.dispose(); this.canvas.remove(); this.canvas=null; this.contourCache.clear(); this.artworkCache.clear();
  }
}
