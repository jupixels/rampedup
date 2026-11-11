// Non-colliding visual detailing for the existing procedural BMX and skatepark.
import * as THREE from 'three';
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const M={
 alloy:new THREE.MeshStandardMaterial({color:0xb9c5cd,metalness:.88,roughness:.23}),
 graphite:new THREE.MeshStandardMaterial({color:0x20252a,metalness:.55,roughness:.35}),
 rubber:new THREE.MeshStandardMaterial({color:0x111315,roughness:.94}),
 amber:new THREE.MeshPhysicalMaterial({color:0xffb32f,metalness:.45,roughness:.3,clearcoat:.85}),
 white:new THREE.MeshStandardMaterial({color:0xf0eee7,roughness:.66}),
 seam:new THREE.MeshStandardMaterial({color:0x15191d,roughness:.9})
};
function add(g,mat,parent,p){const o=new THREE.Mesh(g,mat);if(p)o.position.copy(p);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
function rod(a,b,r,mat,parent){const d=b.clone().sub(a),len=d.length();if(len<.0001)return;const o=add(new THREE.CylinderGeometry(r,r,len,10),mat,parent,a.clone().addScaledVector(d,.5));o.quaternion.setFromUnitVectors(V(0,1,0),d.normalize());return o;}
function ring(r,t,mat,parent,x=0){const o=add(new THREE.TorusGeometry(r,t,8,48),mat,parent,V(x,0,0));o.rotation.y=Math.PI/2;return o;}
function box(w,h,d,mat,parent,x,y,z){return add(new THREE.BoxGeometry(w,h,d),mat,parent,V(x,y,z));}
export function decorateBike(model,{rear,fork,bars,rearSpin,frontSpin,parts,seatTop,rearAxle,frontAxle}){
  // Rotate metal rim layers, pinstriping and axle details with both wheels.
  for(const spin of [rearSpin,frontSpin]){
    for(const side of [-1,1]){
      ring(.203,.006,M.alloy,spin,side*.043);
      ring(.193,.003,M.graphite,spin,side*.047);
      ring(.226,.0025,M.white,spin,side*.032);
      const hub=add(new THREE.CylinderGeometry(.037,.037,.012,18),M.alloy,spin,V(side*.05,0,0));hub.rotation.z=Math.PI/2;
      for(let i=0;i<12;i++){const a=i*Math.PI/6;add(new THREE.SphereGeometry(.0045,5,4),M.alloy,spin,V(side*.029,Math.cos(a)*.199,Math.sin(a)*.199));}
    }
  }
  // CNC hardware and dropout plates remain fixed to the bike frame/fork pivots.
  for(const side of [-1,1]){
    box(.012,.051,.075,M.alloy,rear,side*.071,rearAxle.y,rearAxle.z+.013);
    const nut=add(new THREE.CylinderGeometry(.022,.022,.016,6),M.graphite,rear,V(side*.086,rearAxle.y,rearAxle.z));nut.rotation.z=Math.PI/2;
    const washer=add(new THREE.CylinderGeometry(.026,.026,.011,16),M.alloy,fork,V(side*.07,frontAxle.y,frontAxle.z));washer.rotation.z=Math.PI/2;
  }
  rod(seatTop.clone().add(V(0,.075,-.026)),seatTop.clone().add(V(0,.10,-.032)),.019,M.graphite,rear);
  // Soft top tube pad: deliberately follows the original tailwhip pivot.
  rod(V(0,.63,-.12),V(0,.625,.32),.026,M.graphite,rear);
  for(const z of [-.10,.30])rod(V(0,.63,z-.011),V(0,.63,z+.011),.028,M.amber,rear);
  // Stem plate and clamp bolts follow handlebar spins.
  box(.105,.043,.038,M.alloy,bars,0,.7,.35);
  for(const x of [-.036,.036])for(const y of [.683,.716])add(new THREE.SphereGeometry(.008,7,5),M.graphite,bars,V(x,y,.372));
  for(const p of model.pedals)for(const x of [-.035,.035])for(const z of [-.035,.035])add(new THREE.CylinderGeometry(.004,.004,.009,6),M.alloy,p.pedal,V(x,.016,z));
  // Helmet vents, visor rivets and chin ventilation follow head animation.
  for(const side of [-1,1]){
    for(let i=0;i<3;i++){const vent=box(.011,.018,.03,M.seam,parts.head,side*.12,.065,-.08+i*.047);vent.rotation.z=side*.24;}
    const hinge=add(new THREE.CylinderGeometry(.019,.019,.013,14),M.alloy,parts.head,V(side*.133,-.026,.05));hinge.rotation.z=Math.PI/2;
  }
  for(let i=-2;i<=2;i++)box(.015,.009,.006,M.seam,parts.head,i*.021,-.083,.162);
  box(.21,.014,.014,M.graphite,parts.head,0,.044,.135).rotation.x=-.14;
  // Tailored jersey panels and protectors follow the existing IK limbs.
  box(.22,.17,.01,M.graphite,parts.torso,0,.31,.124);
  for(const side of [-1,1]){
    box(.013,.26,.012,M.amber,parts.torso,side*.108,.25,.094).rotation.z=side*.09;
  }
  for(let i=0;i<2;i++){
    const pad=add(new THREE.SphereGeometry(.043,10,8),M.graphite,parts.fArm[i],V(0,-.09,.039));pad.scale.set(1,.72,.5);
    box(.052,.04,.012,M.alloy,parts.kneePad[i],0,0,.061);
    for(let k=0;k<4;k++)box(.078,.007,.012,M.rubber,parts.foot[i],0,-.029,-.063+k*.065);
  }
}
export function decorateRamp(builder,profile,width,transform,topMaterial){
  const pts=profile.pts||profile;
  if(width>22||pts.length<2)return;
  const total=Math.abs(pts[pts.length-1][0]-pts[0][0]);
  if(total<.5)return;
  const mat=['dirt','dirtLight','rock'].includes(topMaterial)?'wood':'metal';
  for(const side of [-1,1]){
    const points=[];
    for(const [z,y] of pts){const p=V(side*(width/2-.035),y+.023,z);if(!points.length||points[points.length-1].distanceToSquared(p)>.00001)points.push(p);}
    if(points.length>1){
      const curve=new THREE.CatmullRomCurve3(points,false,'centripetal');
      builder.add(new THREE.TubeGeometry(curve,Math.min(100,Math.max(12,points.length*2)),.013,6,false),mat,transform,{cast:false});
    }
  }
  // Small high-contrast metal-painted lip marker, kept out of collision geometry.
  if(!['dirt','dirtLight','rock'].includes(topMaterial)&&total>2&&width<12){
    const idx=Math.max(0,pts.length-3),p=pts[idx],q=pts[Math.min(idx+1,pts.length-1)];
    const pitch=Math.atan2(q[1]-p[1],q[0]-p[0]);
    const local=new THREE.Matrix4().makeRotationX(-pitch).setPosition(0,p[1]+.028,p[0]);
    builder.add(new THREE.BoxGeometry(width-.2,.008,.065),'railYellow',transform.clone().multiply(local),{cast:false});
  }
}
export function decorateLedge(builder,{x,z,y,w,h,d,yaw=0,ledge=false}){
  if(!ledge||w>70||d>70||h<.1)return;
  const longX=w>=d;
  for(const side of [-1,1]){
    const geo=new THREE.BoxGeometry(longX?w:.043,.018,longX?.043:d);
    const offset=longX?V(0,h+.009,side*(d/2-.022)):V(side*(w/2-.022),h+.009,0);
    const m=builder.matrix(x,y,z,yaw).multiply(new THREE.Matrix4().makeTranslation(offset.x,offset.y,offset.z));
    builder.add(geo,'metal',m,{cast:false});
  }
}
