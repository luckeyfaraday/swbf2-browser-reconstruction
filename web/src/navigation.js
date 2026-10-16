import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';

export function insidePolygon(x,z,points) {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[i],b=points[j];
    if((a[2]>z)!==(b[2]>z)&&x<(b[0]-a[0])*(z-a[2])/(b[2]-a[2])+a[0])inside=!inside;
  }
  return inside;
}
class Heap {
  items=[];
  push(item){let i=this.items.length;this.items.push(item);while(i){const parent=(i-1)>>1;if(this.items[parent].priority<=item.priority)break;this.items[i]=this.items[parent];i=parent;}this.items[i]=item;}
  pop(){const first=this.items[0],last=this.items.pop();if(this.items.length){let i=0;while(true){let child=i*2+1;if(child>=this.items.length)break;if(child+1<this.items.length&&this.items[child+1].priority<this.items[child].priority)child++;if(this.items[child].priority>=last.priority)break;this.items[i]=this.items[child];i=child;}this.items[i]=last;}return first;}
}

// Explicit reconstruction, not original BF2 navigation data. Nodes and edges
// are derived from the actual map's collision triangles and recovered polygon.
export class CollisionNavigation {
  constructor(world,manifest,player,{spacing=1.4,maxExpanded=18000}={}) {
    this.world=world;this.polygon=manifest.combatArea?.points;
    this.spacing=spacing;this.maxExpanded=maxExpanded;this.radius=player.radius;this.height=player.height;this.step=player.stepHeight;
    this.floorNormal=Math.cos(THREE.MathUtils.degToRad(player.maxSlopeAngle));
    this.minY=Math.min(...manifest.spawns.map(s=>s.position[1]))-5;
    this.maxY=Math.max(...manifest.spawns.map(s=>s.position[1]))+8;
    this.columns=new Map();this.edges=new Map();this.routes=new Map();this.pathRequests=0;this.pathFailures=0;
    this.ray=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
    this.capsule=new Capsule(new THREE.Vector3(),new THREE.Vector3(),this.radius);
  }
  clearBody(x,y,z) {
    this.capsule.start.set(x,y+this.radius+.04,z);this.capsule.end.set(x,y+this.height-this.radius+.04,z);
    const hit=this.world.capsuleIntersect(this.capsule,{floorNormalY:this.floorNormal,stepHeight:this.step});
    return !hit||(hit.normal.y>.7&&hit.depth<this.step+.04)||hit.depth<.025;
  }
  ground(x,z,expected) {
    let best=null;
    for(const [dx,dz]of [[0,0],[-this.radius*.7,0],[this.radius*.7,0],[0,-this.radius*.7],[0,this.radius*.7]]) {
      this.ray.origin.set(x+dx,expected+this.step+.15,z+dz);this.ray.direction.set(0,-1,0);
      const hit=this.world.rayIntersect(this.ray,0,this.step+1.1);
      if(!hit)continue;
      const normal=hit.triangle.getNormal(new THREE.Vector3());
      if(normal.y<this.floorNormal)continue;
      const y=hit.point.y;
      if(y<=expected+this.step+.08&&y>=expected-.85&&(best===null||y>best))best=y;
    }
    return best;
  }
  column(ix,iz) {
    const key=`${ix},${iz}`;if(this.columns.has(key))return this.columns.get(key);
    const x=ix*this.spacing,z=iz*this.spacing,nodes=[];this.columns.set(key,nodes);
    if(this.polygon&&!insidePolygon(x,z,this.polygon))return nodes;
    let height=this.maxY;
    for(let surface=0;surface<24&&height>this.minY;surface++) {
      this.ray.origin.set(x,height,z);this.ray.direction.set(0,-1,0);
      const hit=this.world.rayIntersect(this.ray,0,height-this.minY);if(!hit)break;
      const y=hit.point.y,normal=hit.triangle.getNormal(new THREE.Vector3());height=y-.12;
      if(normal.y<this.floorNormal||nodes.some(node=>Math.abs(node.position.y-y)<.45)||!this.clearBody(x,y,z))continue;
      const node={id:`${key},${Math.round(y*20)}`,ix,iz,position:new THREE.Vector3(x,y,z)};nodes.push(node);
    }
    return nodes;
  }
  nearest(position,{toward=false}={}) {
    const p=position.isVector3?position:new THREE.Vector3(...position),ix=Math.round(p.x/this.spacing),iz=Math.round(p.z/this.spacing);
    let best=null,bestDistance=Infinity;
    for(let radius=0;radius<=2;radius++) {
      for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++)for(const node of this.column(ix+dx,iz+dz)) {
        const dy=Math.abs(p.y-node.position.y);if(dy>2.5)continue;
        const distance=Math.hypot(node.position.x-p.x,node.position.z-p.z)+dy*3;
        // A nearby cell may be across a thin wall or on a disconnected ledge.
        // Only attach endpoints through a traversable segment, in the route's
        // direction (dropping a ledge is not the same as climbing it).
        const anchor={position:p};
        if(distance<bestDistance&&(toward?this.connected(node,anchor,false):this.connected(anchor,node,false))){best=node;bestDistance=distance;}
      }
      if(bestDistance<this.spacing*.9)break;
    }
    return best;
  }
  connected(a,b,cache=true) {
    // Dropping a ledge and stepping up it have different limits. A reverse
    // query must not reuse the forward traversal decision.
    const key=`${a.id}>${b.id}`;
    if(cache&&this.edges.has(key))return this.edges.get(key);
    const horizontal=Math.hypot(a.position.x-b.position.x,a.position.z-b.position.z),dy=Math.abs(a.position.y-b.position.y);
    let valid=dy<=horizontal*Math.tan(Math.acos(this.floorNormal))+.1;
    if(valid) {
      const count=Math.ceil(horizontal/.35);let previous=a.position.y;
      for(let step=1;step<=count;step++) {
        const t=step/count,x=THREE.MathUtils.lerp(a.position.x,b.position.x,t),z=THREE.MathUtils.lerp(a.position.z,b.position.z,t);
        const expected=THREE.MathUtils.lerp(a.position.y,b.position.y,t),y=this.ground(x,z,expected);
        if(y===null||y-previous>this.step+.08||previous-y>.85||!this.clearBody(x,y,z)){valid=false;break;}
        previous=y;
      }
    }
    if(cache)this.edges.set(key,valid);return valid;
  }
  findPath(from,to) {
    this.pathRequests++;
    const start=this.nearest(from),goal=this.nearest(to,{toward:true});if(!start||!goal){this.pathFailures++;return [];}
    const routeKey=`${start.id}>${goal.id}`;
    if(this.routes.has(routeKey))return this.routes.get(routeKey).map(point=>point.clone());
    const heap=new Heap(),costs=new Map([[start.id,0]]),parents=new Map(),visited=new Set(),nodes=new Map([[start.id,start]]);
    heap.push({node:start,priority:start.position.distanceTo(goal.position)});
    let found=null;
    while(heap.items.length&&visited.size<this.maxExpanded) {
      const {node}=heap.pop();if(visited.has(node.id))continue;visited.add(node.id);
      if(node.id===goal.id){found=node;break;}
      for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++) {
        if(!dx&&!dz)continue;
        for(const neighbor of this.column(node.ix+dx,node.iz+dz)) {
          if(visited.has(neighbor.id)||!this.connected(node,neighbor))continue;
          const cost=costs.get(node.id)+node.position.distanceTo(neighbor.position);
          if(cost>=(costs.get(neighbor.id)??Infinity))continue;
          nodes.set(neighbor.id,neighbor);parents.set(neighbor.id,node.id);costs.set(neighbor.id,cost);
          heap.push({node:neighbor,priority:cost+neighbor.position.distanceTo(goal.position)});
        }
      }
    }
    const route=[];
    if(found)for(let id=found.id;id;id=parents.get(id))route.push(nodes.get(id).position.clone());
    else this.pathFailures++;
    route.reverse();if(this.routes.size>128)this.routes.clear();this.routes.set(routeKey,route);
    return route.map(point=>point.clone());
  }
  snapshot(){return {kind:'provisional-collision-derived-multilayer-grid-A-star',sourcePolygon:!!this.polygon,spacing:this.spacing,columns:this.columns.size,nodes:[...this.columns.values()].reduce((sum,nodes)=>sum+nodes.length,0),edges:this.edges.size,pathRequests:this.pathRequests,pathFailures:this.pathFailures,cachedRoutes:this.routes.size};}
}
