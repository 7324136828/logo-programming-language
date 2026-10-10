import * as THREE from 'three';
import * as frog from '../data/a_frog.js';
import * as fish from '../data/a_fish.js';
import * as elephant from '../data/a_elephant.js';
import * as horse from '../data/a_horse.js';
import * as spring from '../data/a_spring.js';

const originals = { A_FROG: frog, A_FISH: fish, A_ELEPHANT: elephant, A_HORSE: horse, A_SPRING: spring };
const mix = (color, target, amount) => new THREE.Color(color).lerp(new THREE.Color(target), amount).getStyle();
const matches = (sampler,kind,id,data,size) => {
  const reference = originals[sampler]?.[kind];
  return Boolean(reference && data?.length === size && data.every((value,index) => value === reference[id*size+index]));
};
export const isOriginalSamplerPattern = (sampler,id,data) => matches(sampler,'spritePatterns',id,data,32);
const part = (shape, fill) => ({ shape, fill });
function path(commands) {
  const shape = new THREE.Shape();
  for (const [command,...args] of commands) shape[command](...args);
  shape.closePath(); return shape;
}
function ellipse(x,y,rx,ry=rx) { const shape=new THREE.Shape();shape.absellipse(x,y,rx,ry,0,Math.PI*2,false);return shape; }
function rect(x,y,w,h) { return path([['moveTo',x,y],['lineTo',x+w,y],['lineTo',x+w,y+h],['lineTo',x,y+h]]); }
function ring(x,y,rx,ry,thickness=0.5) {const shape=ellipse(x,y,rx,ry);shape.holes.push(ellipse(x,y,rx-thickness,ry-thickness));return shape;}
function line(x1,y1,x2,y2,width=0.65) {
  const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy),nx=-dy/len*width/2,ny=dx/len*width/2;
  return path([['moveTo',x1+nx,y1+ny],['lineTo',x2+nx,y2+ny],['lineTo',x2-nx,y2-ny],['lineTo',x1-nx,y1-ny]]);
}
function drop(x,y,scale=1) {
  return path([['moveTo',x,y+3.3*scale],['bezierCurveTo',x+4*scale,y-1*scale,x+2.8*scale,y-3.3*scale,x,y-3.3*scale],['bezierCurveTo',x-2.8*scale,y-3.3*scale,x-4*scale,y-1*scale,x,y+3.3*scale]]);
}

/** Clip an illustrated silhouette into the original independently movable sprite/tile pieces. */
function clipPoints(points, bounds) {
  const [left,bottom,right,top]=bounds;
  for(const [axis,edge,sign] of [[0,left,1],[0,right,-1],[1,bottom,1],[1,top,-1]]){
    const result=[];
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],insideA=(a[axis]-edge)*sign>=-1e-9,insideB=(b[axis]-edge)*sign>=-1e-9;
      if(insideA)result.push(a);
      if(insideA!==insideB){const ratio=(edge-a[axis])/(b[axis]-a[axis]);result.push([a[0]+(b[0]-a[0])*ratio,a[1]+(b[1]-a[1])*ratio]);}
    }
    points=result;if(!points.length)break;
  }
  return points;
}
function polygon(points,offset,Type=THREE.Shape) {
  const result=new Type();result.moveTo(points[0][0]-offset[0],points[0][1]-offset[1]);
  for(const point of points.slice(1))result.lineTo(point[0]-offset[0],point[1]-offset[1]);result.closePath();return result;
}
function clipped(parts,center,size=16) {
  const bounds=[center[0]-size/2,center[1]-size/2,center[0]+size/2,center[1]+size/2],result=[];
  for(const {shape,fill} of parts){
    const outer=clipPoints(shape.getPoints(48).map(point=>[point.x,point.y]),bounds);
    if(outer.length<3)continue;
    const converted=polygon(outer,center);
    for(const hole of shape.holes){const points=clipPoints(hole.getPoints(48).map(point=>[point.x,point.y]),bounds);if(points.length>=3)converted.holes.push(polygon(points,center,THREE.Path));}
    result.push(part(converted,fill));
  }
  return result;
}
function frogBody(inset=false) {
  return inset ? path([
    ['moveTo',0.5,4],['bezierCurveTo',0,12,5,20,10,21],['bezierCurveTo',10,27,19,29,21,23],
    ['bezierCurveTo',24,20,20,15,17,14],['bezierCurveTo',14,12,13,8,17,5],
    ['bezierCurveTo',22,1,21,-0.3,14,1],['bezierCurveTo',12,5,7,7,6,9],
    ['bezierCurveTo',9,9,9,5,5,4],['bezierCurveTo',3,3,1,3,0.5,4],
  ]) : path([
    ['moveTo',-0.5,3],['bezierCurveTo',-1,13,4,21,9,22],['bezierCurveTo',10,29,20,30,22,24],
    ['bezierCurveTo',26,20,21,14,18,13],['bezierCurveTo',15,11,14,8,18,5],
    ['bezierCurveTo',25,-1,20,-1.5,13,0],['bezierCurveTo',11,5,6,6,5,8],
    ['bezierCurveTo',7,6,6,3,3,2],['bezierCurveTo',1,1,-1,1,-0.5,3],
  ]);
}
function frogParts(id,color) {
  const centers=[[0,0],[16,6],[0,16],[16,22]];
  if(id>=6&&id<=9){
    const silhouette=frogBody();silhouette.holes.push(frogBody(true));
    const details=[part(silhouette,color),part(ellipse(17.9,24.7,1.35),mix(color,'#102328',0.65)),part(ellipse(18.3,25.1,.38),'#ffffff'),
      part(path([['moveTo',17,18],['bezierCurveTo',19,17,20.5,17.5,21.4,18.4],['lineTo',21.2,17.7],['bezierCurveTo',19,16,17.2,17.1,17,18]]),color),
      part(path([['moveTo',3.1,5.1],['bezierCurveTo',9,5.1,11,9,7.5,11],['bezierCurveTo',12,9,10,4.7,3.1,5.1]]),color)];
    return clipped(details,centers[id-6]);
  }
  if(id>=10&&id<=13)return clipped([part(frogBody(true),color),part(ellipse(9,16,2.8,1.2),mix(color,'#ffffff',.23))],centers[id-10]);
  if(id===14)return [part(line(-7,-7,7,7,1.05),color),part(ellipse(7,7,.65),color)];
  if(id===15)return [part(ellipse(-6.3,7,1.6,1),'#bfd4df'),part(ellipse(-4.4,7,1.6,1),'#bfd4df'),part(ellipse(-5.3,6.1,.7,1.4),color),part(ellipse(-5.3,7,.7),color)];
  if(id===16){
    const leaf=path([['moveTo',0,-2],['lineTo',-2.7,-6.3],['bezierCurveTo',-11,-5,-10,6,-1,7],['bezierCurveTo',8,8,11,-3,3,-6.1],['lineTo',0,-2]]);
    return [part(ellipse(0,-.7,8.4,5.5),mix(color,'#123c42',.45)),part(leaf,color),part(line(-.2,-1.4,0,4.6,.35),mix(color,'#b8e2b1',.36)),part(line(0,.4,-4.6,3.3,.3),mix(color,'#b8e2b1',.36)),part(line(0,1.2,4.1,3.8,.3),mix(color,'#b8e2b1',.36))];
  }
  return null;
}
function fishBody() {
  const shape=path([['moveTo',1,5],['bezierCurveTo',3,14,17,20,23,8],['bezierCurveTo',27,6,23,3,22,2],['bezierCurveTo',17,-7,4,-4,1,4],['bezierCurveTo',-1,-1,-3,-2,-4,-4],['bezierCurveTo',-3,3,-3,8,-4,13],['bezierCurveTo',-1,12,0,8,1,5]]);
  shape.holes.push(ellipse(20,8,1.6));return shape;
}
function fishParts(id,color) {
  if(id>=6&&id<=9)return clipped([part(fishBody(),color),part(path([['moveTo',6,7],['bezierCurveTo',9,12,11,12,13,9],['bezierCurveTo',9,8,8,6,6,7]]),mix(color,'#ffffff',.23)),part(path([['moveTo',7,14],['bezierCurveTo',11,21,16,21,17,15],['bezierCurveTo',14,16,10,15,7,14]]),mix(color,'#173f5c',.2))],[[0,0],[16,0],[0,16],[16,16]][id-6]);
  if(id===10)return [part(ellipse(4,6,1.6),color),part(ellipse(4.5,6.5,.45),'#ffffff')];
  if(id===11)return [part(ring(-3,-2.5,4,4,.45),color),part(ellipse(-4.4,-.4,.65),color)];
  return null;
}
function springParts(id,color) {
  if(id===10){
    const result=[];
    for(let i=0;i<8;i++){
      const angle=i*Math.PI/4,shape=ellipse(Math.cos(angle)*4.3,Math.sin(angle)*4.3,2.2,3.3);
      // Rotate each petal around its own center using the shape points.
      const center=[Math.cos(angle)*4.3,Math.sin(angle)*4.3];
      const rotated=shape.getPoints(36).map(p=>{const x=p.x-center[0],y=p.y-center[1],a=angle-Math.PI/2;return [center[0]+x*Math.cos(a)-y*Math.sin(a),center[1]+x*Math.sin(a)+y*Math.cos(a)];});
      result.push(part(polygon(rotated,[0,0]),i%2?mix(color,'#ffffff',.13):color));
    }
    result.push(part(ellipse(0,0,2.3),'#f3cb6c'),part(ellipse(-.6,.7,.6),'#ffe5a2'));return result;
  }
  if(id===11)return [part(path([['moveTo',-.5,-8],['bezierCurveTo',-1,0,1,4,0,8],['lineTo',.9,8],['bezierCurveTo',1.7,1,-.1,-3,.3,-8]]),color),
    part(path([['moveTo',0,2],['bezierCurveTo',-4,2,-7,6,-6,6.4],['bezierCurveTo',-2,8,1,4,0,2]]),mix(color,'#9bdaa6',.18)),
    part(path([['moveTo',0,3],['bezierCurveTo',3,7,6,7,6.6,5.7],['bezierCurveTo',5,2,2,1,0,3]]),color)];
  if(id===12)return [part(path([['moveTo',0,7],['bezierCurveTo',8,-1,4,-7,0,-7],['bezierCurveTo',-4,-7,-8,-1,0,7]]),color),part(path([['moveTo',-.2,-7],['bezierCurveTo',-1,-3,-1,0,0,3],['bezierCurveTo',1,-2,1,-5,-.2,-7]]),mix(color,'#264e40',.35))];
  if(id===13)return [part(path([['moveTo',0,5.5],['bezierCurveTo',1,7,3,5,4,3],['bezierCurveTo',9,-2,5,-7,0,-7],['bezierCurveTo',-5,-7,-8,-2,-4,2],['bezierCurveTo',-3,6,-1,6,0,5.5]]),color),part(ellipse(-2,1.5,1,2),mix(color,'#ffffff',.24))];
  if(id===20)return [part(drop(-2.5,-6.5,.35),color)];
  if(id===4)return [part(ellipse(0,0,7),color),...Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return part(line(Math.cos(a)*8,Math.sin(a)*8,Math.cos(a)*10,Math.sin(a)*10,.6),color);})];
  return null;
}
function horseBody(inset=false) {
  return path(inset?[
    ['moveTo',-2,3],['bezierCurveTo',-3,8,8,10,12,7],['lineTo',14,11],['lineTo',15,16],['lineTo',17,14],
    ['bezierCurveTo',20,15,22,12,21,10],['lineTo',17,9],['bezierCurveTo',17,4,16,2,13,1],
    ['lineTo',15,-6],['lineTo',13,-6],['lineTo',10,1],['lineTo',3,1],['lineTo',1,-6],['lineTo',-1,-6],['lineTo',0,2],
  ]:[
    ['moveTo',-3,3],['bezierCurveTo',-4,9,7,11,12,8],['lineTo',13,12],['lineTo',14,18],['lineTo',17,15],
    ['bezierCurveTo',21,16,24,12,22,9],['lineTo',18,8],['bezierCurveTo',18,3,17,1,14,0],
    ['lineTo',16,-7],['lineTo',12,-7],['lineTo',9,0],['lineTo',4,0],['lineTo',2,-7],['lineTo',-2,-7],['lineTo',-1,2],
  ]);
}
function horseParts(id,color) {
  const centers={6:[0,0],7:[0,0],8:[16,0],9:[16,0],10:[16,16],11:[16,16]};
  if(centers[id]){
    if(id%2){return clipped([part(horseBody(true),color),part(ellipse(7,4.5,5,1.2),mix(color,'#ffffff',.25))],centers[id]);}
    const border=horseBody();border.holes.push(horseBody(true));
    return clipped([part(border,color),part(ellipse(19,12,0.7),color),
      part(path([['moveTo',13.5,13],['bezierCurveTo',10,10,10,6,12,3],['lineTo',14,4],['bezierCurveTo',12,7,12,11,13.5,13]]),color),
      part(path([['moveTo',-3,6],['bezierCurveTo',-8,8,-7,1,-8,-2],['bezierCurveTo',-4,1,-6,4,-3,5]]),color)],centers[id]);
  }
  if(id===16||id===17)return [part(rect(-.6,-8,1.2,16),color),part(path([['moveTo',0,7],['bezierCurveTo',3,7,5,4,8,6],['lineTo',8,1.5],['bezierCurveTo',5,-.5,3,4,0,3]]),color)];
  if(id===18)return [part(rect(4.7,-8,1.1,16),color),part(rect(5.1,-8,.25,16),mix(color,'#ffffff',.55))];
  return null;
}
function elephantBody() {
  return path([
    ['moveTo',10,-24],['lineTo',10,-35],['quadraticCurveTo',10,-38,17,-38],['lineTo',21,-38],['lineTo',21,-24],
    ['lineTo',24,-24],['lineTo',24,-37],['quadraticCurveTo',24,-39,32,-39],['lineTo',33,-24],
    ['quadraticCurveTo',46,-25,54,-23],['lineTo',54,-36],['quadraticCurveTo',54,-39,62,-39],['lineTo',63,-23],
    ['bezierCurveTo',74,-19,70,13,60,18],['bezierCurveTo',52,24,43,25,34,23],
    ['bezierCurveTo',30,33,19,36,12,27],['bezierCurveTo',6,23,6,17,4,15],
    ['bezierCurveTo',-7,14,-9,31,0,39],['bezierCurveTo',4,42,9,42,12,39],
    ['bezierCurveTo',8,46,1,45,-4,41],['bezierCurveTo',-10,29,-7,11,2,7],
    ['bezierCurveTo',7,5,8,3,10,0],['quadraticCurveTo',7,-10,10,-24],
  ]);
}
function elephantParts(id,color) {
  const soft=mix(color,'#8795a4',.25);
  if(id===6)return [part(ellipse(3,0,1.4),color),part(ellipse(3.5,.5,.35),'#ffffff')];
  if(id===7){const ear=ellipse(-2,-5,8,12);ear.holes.push(ellipse(-1.5,-4.5,7,11));return [part(ear,soft),part(path([['moveTo',-4,2],['bezierCurveTo',-6,-3,-6,-7,-2,-11],['bezierCurveTo',-8,-7,-8,-2,-4,2]]),soft)];}
  if(id===8)return [part(path([['moveTo',-7,6],['bezierCurveTo',-5,0,4,-2,8,4],['bezierCurveTo',4,0,1,2,-7,6]]),'#fff4dc')];
  if(id===9)return [part(path([['moveTo',11,-9],['bezierCurveTo',18,-16,17,-24,15,-27],['lineTo',14,-26],['bezierCurveTo',16,-17,13,-13,11,-9]]),soft),part(ellipse(14,-27,1.2,2.2),color)];
  if(id===10||id===11)return [part(rect(-7,6,6,.55),soft),part(rect(-5,4.5,.5,1.5),soft),part(rect(-3,4.5,.5,1.5),soft)];
  if(id===12)return [part(path([['moveTo',-5,-5],['bezierCurveTo',-3,-4,0,-5,1,-7],['bezierCurveTo',-2,-6,-4,-7,-5,-5]]),soft)];
  if(id===13)return [part(drop(-5.5,-6,.7),color),part(ellipse(-6.2,-5.5,.4),'#d4f1ff')];
  return null;
}

export function semanticSamplerParts(samplerId,shapeId,data,color) {
  if(!matches(samplerId,'spritePatterns',shapeId,data,32))return null;
  if(samplerId==='A_FROG')return frogParts(shapeId,color);
  if(samplerId==='A_FISH')return fishParts(shapeId,color);
  if(samplerId==='A_SPRING')return springParts(shapeId,color);
  if(samplerId==='A_HORSE')return horseParts(shapeId,color);
  if(samplerId==='A_ELEPHANT')return elephantParts(shapeId,color);
  return null;
}

export function semanticSamplerTileParts(samplerId,id,data,color,{col=0,row=0}={}) {
  if(!matches(samplerId,'characterPatterns',id,data,8))return null;
  if(samplerId==='A_ELEPHANT'){
    if(id>=100&&id<210){const offset=id-100;return clipped([part(elephantBody(),color)],[-4+(offset%10)*8,44-Math.floor(offset/10)*8],8);}
    if(id===216)return [part(rect(-4,-4,8,8),mix(color,'#819292',.65)),part(rect(-4,2.8,8,.45),mix(color,'#ffffff',.8)),part(rect(0,-4,.4,7),mix(color,'#ffffff',.7))];
    if(id===224)return [part(rect(-4,-4,8,8),color),part(rect(-4,1.5,8,1.6),mix(color,'#ffffff',.4)),part(rect(-4,3.2,8,.8),mix(color,'#26394b',.5))];
    if(id>=225&&id<=227){
      const bucket=path([['moveTo',-4,4],['lineTo',20,4],['lineTo',18,-3],['quadraticCurveTo',8,-6,-2,-3]]);
      return clipped([part(bucket,color),part(rect(-4,2,24,.6),mix(color,'#253744',.25))],[(id-225)*8,0],8);
    }
  }
  if(samplerId==='A_FROG'&&id===100){
    const pond=path([['moveTo',-128,-4],['bezierCurveTo',-70,2,-26,-2,0,-1],['bezierCurveTo',35,2,90,1,128,-3],['lineTo',128,-96],['lineTo',-128,-96]]);
    const center=[col*8-124,92-row*8];const result=clipped([part(pond,mix(color,'#4aa9bc',.4))],center,8);
    if(row>12&&(col+row*3)%9===0)result.push(part(ring(0,0,3.4,.65,.15),mix(color,'#ffffff',.35)));
    return result;
  }
  if(samplerId==='A_SPRING'&&id===100)return [part(rect(-4,-4,8,8),mix(color,'#275e4c',.22)),part(path([['moveTo',-4,-4],['quadraticCurveTo',-2,1,-3,4],['quadraticCurveTo',1,0,0,-4]]),mix(color,'#a4d3a0',.25)),part(path([['moveTo',1,-4],['quadraticCurveTo',3,2,4,4],['quadraticCurveTo',4,0,4,-4]]),mix(color,'#143e31',.2))];
  if(samplerId==='A_HORSE'&&id===120)return [part(rect(-1.3,-4,2.6,8),color),part(rect(-.6,-4,.55,8),mix(color,'#ffffff',.4))];
  return null;
}
