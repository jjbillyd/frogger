/* Blender-authored assets and lightweight wetland rendering for A-Frame / Quest. */
(() => {
  'use strict';
  const T = AFRAME.THREE;
  const assets = new Map();
  let contactTexture;
  function shadowTexture() {
    if(contactTexture)return contactTexture;
    const c=document.createElement('canvas');c.width=c.height=64;
    const ctx=c.getContext('2d'),g=ctx.createRadialGradient(32,32,4,32,32,31);
    g.addColorStop(0,'rgba(0,0,0,.65)');g.addColorStop(.5,'rgba(0,0,0,.3)');g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
    contactTexture=new T.CanvasTexture(c);return contactTexture;
  }
  function loadAsset(kind) {
    if (!assets.has(kind)) {
      const promise = new Promise((resolve, reject) => new T.GLTFLoader().load(
        `Assets/models/${kind}.glb`, resolve, undefined, reject));
      assets.set(kind, promise);
      promise.catch(() => assets.delete(kind)); // A later start can retry a failed request.
    }
    return assets.get(kind);
  }
  // Object3D.clone shares skeletons. Remap every joint to the corresponding clone.
  function cloneRig(source) {
    const clone = source.clone(true), map = new Map();
    function pair(a, b) { map.set(a, b); a.children.forEach((c, i) => pair(c, b.children[i])); }
    pair(source, clone);
    source.traverse(original => {
      const copy = map.get(original);
      if (original.isSkinnedMesh) {
        copy.skeleton = original.skeleton.clone();
        copy.skeleton.bones = original.skeleton.bones.map(b => map.get(b));
        copy.bind(copy.skeleton, original.bindMatrix);
        copy.frustumCulled = true;
      }
      if (copy.isMesh) {
        copy.material = original.material.clone();
        copy.castShadow = true; copy.receiveShadow = true;
      }
    });
    return clone;
  }
  window.Wetland = { preload: () => Promise.all(['frog', 'crocodile', 'log', 'car', 'truck'].map(loadAsset)) };

  AFRAME.registerComponent('wetland-model', {
    schema: { kind: {default: 'frog'}, length: {default: 1}, color: {default:'#b55438'}, headlights: {default:.15}, taillights: {default:.3} },
    init() {
      this.removed = false; this.elapsed = 0; this.warning = false; this.jawAngle = 0; this.cameraOpacity = 1; this.cameraWorld = new T.Vector3();
      this.onHop = e => { this.hop = {...e.detail, elapsed: 0}; };
      this.el.addEventListener('frog-hop', this.onHop);
      loadAsset(this.data.kind).then(gltf => {
        if (this.removed) return;
        this.model = cloneRig(gltf.scene);
        if(this.data.kind==='frog')this.model.traverse(o=>{if(o.isSkinnedMesh)o.frustumCulled=false;});
        this.el.setObject3D('mesh', this.model);
        if(this.data.kind==='frog') {
          this.contact=new T.Mesh(new T.PlaneGeometry(1.3,1.4),new T.MeshBasicMaterial({map:shadowTexture(),transparent:true,depthWrite:false,opacity:.55}));
          this.contact.rotation.x=-Math.PI/2;this.contact.position.y=.016;
          this.el.setObject3D('contact-shadow',this.contact);
        }
        this.model.scale.x = this.data.kind === 'log' ? this.data.length : 1;
        this.mixer = new T.AnimationMixer(this.model);
        if (gltf.animations.length) {
          // The crocodile jaw is controlled by gameplay, outside the swimming clip.
          let clip = gltf.animations[0];
          if (this.data.kind === 'crocodile') {
            clip = clip.clone(); clip.tracks = clip.tracks.filter(t => !t.name.startsWith('Jaw.'));
          }
          this.action = this.mixer.clipAction(clip); this.action.play();
          if (this.data.kind === 'frog') {
            this.action.setLoop(T.LoopOnce, 1); this.action.clampWhenFinished = true;
            this.action.paused = true; this.mixer.update(0);
          } else {
            this.action.time = Math.random() * clip.duration;
            this.action.timeScale = this.data.kind === 'log' ? .33 : .65;
          }
        }
        this.jaw = this.model.getObjectByName('Jaw');
        if (this.jaw) this.jawRest = this.jaw.quaternion.clone();
        this.eyeMaterials = []; this.headMaterials = []; this.tailMaterials = [];
        this.model.traverse(o => {
          if(o.isMesh && o.material.name.includes('enamel paint')) o.material.color.set(this.data.color);
          if(o.isMesh && o.material.name.includes('headlamp')) this.headMaterials.push(o.material);
          if(o.isMesh && o.material.name.includes('taillamp')) this.tailMaterials.push(o.material);
          if (o.isMesh && o.material.name.includes('amber iris')) this.eyeMaterials.push(o.material);
        });
        this.el.emit('wetland-ready', {kind: this.data.kind});
      }).catch(error => {
        console.error(`Unable to load ${this.data.kind} model`, error);
        this.el.emit('wetland-error', {kind: this.data.kind});
      });
    },
    setWarning(value) { this.warning = value; },
    cancelHop() {
      if (this.hop && this.model) {
        this.el.object3D.position.add(this.model.position);
        this.model.position.set(0, 0, 0);
      }
      this.hop = null;
    },
    tick(time, delta) {
      if (!this.model) return;
      const game = document.querySelector('[frogger-game]')?.components['frogger-game'];
      if (!game?.active || game.dead || game.gameOver) return;
      const dt = Math.min(delta, 100) / 1000;
      this.elapsed += dt;
      if (this.data.kind === 'frog') {
        if (this.hop) {
          this.hop.elapsed += dt;
          const t = Math.min(1, this.hop.elapsed / .24);
          // Short planted crouch, powerful push, ballistic arc, forelimb landing.
          const travel = T.MathUtils.smoothstep(t, .10, .94);
          this.model.position.set(this.hop.offset.x * (1-travel),
            this.hop.offset.y * (1-travel) + .58 * Math.sin(Math.PI * travel),
            this.hop.offset.z * (1-travel));
          this.model.rotation.y = Math.atan2(-this.hop.dx, -this.hop.dz);
          if (this.action) {
            this.action.time = t * this.action.getClip().duration;
            this.mixer.update(0);
          }
          if (t === 1) { this.hop = null; this.model.position.set(0,0,0); }
        } else {
          this.model.position.y = .006 * Math.sin(this.elapsed * 3.2);
        }
        if(this.contact){
          this.contact.position.x=this.model.position.x;this.contact.position.z=this.model.position.z;
          this.contact.material.opacity=.55-Math.max(0,this.model.position.y)*.4;
        }
      } else {
        this.mixer.update(dt);
        if(this.data.kind==='car' || this.data.kind==='truck') {
          this.el.sceneEl.camera.getWorldPosition(this.cameraWorld);
          const p=this.el.object3D.position, halfLength=this.data.kind==='truck'?4:2;
          const inside=Math.abs(this.cameraWorld.x-p.x)<halfLength+.55 && Math.abs(this.cameraWorld.z-p.z)<1.7;
          this.cameraOpacity=T.MathUtils.damp(this.cameraOpacity,inside ? 0 : 1,14,dt);
          this.model.traverse(o=>{
            if(!o.isMesh)return;
            const fading=this.cameraOpacity<.995;
            if(o.material.transparent!==fading){o.material.transparent=fading;o.material.needsUpdate=true;}
            o.material.opacity=fading?(this.cameraOpacity<.01?0:this.cameraOpacity):1;o.material.depthWrite=!fading;
            o.castShadow=!fading;
          });
        }
        this.headMaterials.forEach(m=>{m.emissive.set('#fff3b0');m.emissiveIntensity=this.data.headlights;});
        this.tailMaterials.forEach(m=>{m.emissive.set('#ff2222');m.emissiveIntensity=this.data.taillights;});
        if (this.jaw) {
          this.jawAngle = T.MathUtils.damp(this.jawAngle, this.warning ? .66 : 0, this.warning ? 5 : 24, dt);
          // Local X rotates the upper snout upwards; leave its bind orientation intact.
          this.jaw.quaternion.copy(this.jawRest).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0), this.jawAngle));
          this.eyeMaterials.forEach(m => { m.emissive.set('#ff3d08'); m.emissiveIntensity = this.warning ? 1.6 : 0; });
        }
      }
    },
    remove() {
      this.removed = true;
      this.el.removeEventListener('frog-hop', this.onHop);
      if (this.mixer) { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model); }
      if (this.model) this.model.traverse(o => {
        if (o.isMesh) o.material.dispose();
        if (o.isSkinnedMesh) o.skeleton.dispose();
      });
      if(this.contact){this.contact.geometry.dispose();this.contact.material.dispose();this.el.removeObject3D('contact-shadow');}
      this.el.removeObject3D('mesh');
    }
  });

  AFRAME.registerComponent('wetland-lighting', {
    init() { this.enabled=false; this.environment=null; },
    tick() {
      const game=this.el.components['frogger-game'], scene=this.el.sceneEl;
      if(!game || !scene.renderer) return;
      if(game.active !== this.enabled) {
        this.enabled=game.active;
        if(this.enabled) {
          this.previousEnvironment=scene.object3D.environment;
          this.previousShadow=scene.renderer.shadowMap.enabled;
          if(!this.environment) {
            // A tiny generated sky/ground cubemap supplies soft specular lighting.
            const faces=[];
            for(let i=0;i<6;i++) {
              const c=document.createElement('canvas');c.width=c.height=64;
              const ctx=c.getContext('2d');const grad=ctx.createLinearGradient(0,0,0,64);
              grad.addColorStop(0,i===3?'#60614a':'#a6c6c2');
              grad.addColorStop(.5,i===2?'#a6c6c2':'#c7c6a4');
              grad.addColorStop(1,i===2?'#a6c6c2':'#555b39');
              ctx.fillStyle=grad;ctx.fillRect(0,0,64,64);faces.push(c);
            }
            const cube=new T.CubeTexture(faces);cube.colorSpace=T.SRGBColorSpace;cube.needsUpdate=true;
            const pmrem=new T.PMREMGenerator(scene.renderer);
            this.environment=pmrem.fromCubemap(cube);cube.dispose();pmrem.dispose();
          }
          scene.object3D.environment=this.environment.texture;
        } else {
          scene.object3D.environment=this.previousEnvironment;
          scene.object3D.environmentIntensity=1;
          scene.renderer.shadowMap.enabled=this.previousShadow;
          const dir=document.querySelector('#sceneDir')?.components.light?.light;
          if(dir)dir.castShadow=false;
        }
      }
      if(!this.enabled)return;
      const lightEl=document.querySelector('#sceneDir'), sun=lightEl?.components.light?.light;
      const ambient=document.querySelector('#sceneAmbient')?.components.light?.light;
      scene.object3D.environmentIntensity=(ambient?.intensity || .6)*.6;
      // Keep mobile VR on the lighter path; desktop gets contact shadows.
      const shadows=!scene.is('vr-mode');
      scene.renderer.shadowMap.enabled=shadows;scene.renderer.shadowMap.type=T.PCFSoftShadowMap;
      if(sun) {
        sun.castShadow=shadows;
        const p=game.getFrogWorldPos();
        lightEl.object3D.position.set(p.x-15,30,p.z+10);
        sun.target.position.set(p.x,0,p.z);sun.target.updateMatrixWorld();
        if(!this.shadowConfigured) {
          sun.shadow.mapSize.set(1024,1024);sun.shadow.bias=-.0003;sun.shadow.normalBias=.035;
          Object.assign(sun.shadow.camera,{left:-18,right:18,top:18,bottom:-18,near:1,far:70});
          sun.shadow.camera.updateProjectionMatrix();this.shadowConfigured=true;
        }
      }
    },
    remove(){if(this.environment)this.environment.dispose();}
  });

  const vertex = `
    uniform float uTime; uniform float uFlow;
    varying vec3 vWorld; varying vec2 vUv;
    void main() {
      vUv=uv;
      vec3 p=position;
      float x=p.x-uTime*uFlow;
      p.y += .014*sin(x*2.2+p.z*1.7)+.008*sin(x*4.1-p.z*2.5+uTime*.7);
      vec4 world=modelMatrix*vec4(p,1.0); vWorld=world.xyz;
      gl_Position=projectionMatrix*viewMatrix*world;
    }`;
  const fragment = `
    precision highp float;
    uniform float uTime; uniform float uFlow; uniform float uLight;
    uniform vec3 uSky; uniform vec3 uFog; uniform vec3 uSun;
    uniform float uFogNear; uniform float uFogFar;
    varying vec3 vWorld; varying vec2 vUv;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    void main(){
      vec2 p=vWorld.xz; p.x-=uTime*uFlow;
      float a=p.x*2.2+p.y*1.7;
      float b=p.x*4.1-p.y*2.5+uTime*.7;
      float c=p.x*14.0+p.y*11.0+sin(p.y*3.0-uTime)*.6;
      float d=p.x*23.0-p.y*16.0+uTime*.9;
      vec2 q=p*vec2(1.7,5.2);
      q.y+=sin(p.x*.7+uTime*.2)*.6;
      float h=noise(q);
      vec2 ripple=vec2(noise(q+vec2(.09,0))-h,noise(q+vec2(0,.09))-h);
      vec2 slope=vec2(.012*cos(a)+.010*cos(b),.009*cos(a)-.006*cos(b))+ripple*.65;
      vec3 n=normalize(vec3(-slope.x,1.,-slope.y));
      vec3 view=normalize(cameraPosition-vWorld);
      float fresnel=.025+.975*pow(1.-max(dot(view,n),0.),5.);
      float silt=noise(p*vec2(.24,.65))*.65+noise(p*vec2(.9,1.7))*.35;
      vec3 water=mix(vec3(.065,.089,.035),vec3(.18,.15,.066),silt)*uLight;
      vec3 reflected=mix(uFog,uSky,clamp(reflect(-view,n).y*.8+.15,0.,1.));
      vec3 lightDir=normalize(vec3(-.45,.8,.3));
      float spec=pow(max(dot(n,normalize(view+lightDir)),0.),180.);
      vec3 color=mix(water,reflected,clamp(fresnel*.4,.04,.30))+uSun*spec*.22;
      float threads=smoothstep(.80,.94,noise(p*vec2(.8,8.0)))*.065;
      color+=vec3(.30,.28,.17)*threads*uLight;
      float distanceToEye=length(cameraPosition-vWorld);
      color=mix(color,uFog,smoothstep(uFogNear,uFogFar,distanceToEye));
      gl_FragColor=vec4(color,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  AFRAME.registerComponent('wetland-river', {
    schema: { width:{default:60},depth:{default:6},flows:{default:'1,-1,1'},speeds:{default:'1,1,1'} },
    init() {
      const dirs=this.data.flows.split(',').map(Number), speeds=this.data.speeds.split(',').map(Number);
      this.materials=[]; this.group=new T.Group();
      dirs.forEach((dir,i)=>{
        const laneDepth=this.data.depth/dirs.length;
        const geometry=new T.PlaneGeometry(this.data.width,laneDepth,120,8);
        geometry.rotateX(-Math.PI/2);
        const mat=new T.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,uniforms:{
          uTime:{value:0},uFlow:{value:dir*speeds[i]*.55},uLight:{value:1},
          uSky:{value:new T.Color('#7e9d9b')},uFog:{value:new T.Color('#b8c9b0')},
          uSun:{value:new T.Color('#fff1ca')},uFogNear:{value:25},uFogFar:{value:65}
        }});
        const mesh=new T.Mesh(geometry,mat);mesh.position.z=this.data.depth/2-(i+.5)*laneDepth;
        this.group.add(mesh);this.materials.push(mat);
      });
      this.el.setObject3D('mesh',this.group);
    },
    tick() {
      const game=document.querySelector('[frogger-game]')?.components['frogger-game'];
      if (!game) return;
      const fog=this.el.sceneEl.object3D.fog;
      const ambient=document.querySelector('#sceneAmbient')?.components.light?.light;
      const sun=document.querySelector('#sceneDir')?.components.light?.light;
      this.materials.forEach(m=>{
        m.uniforms.uTime.value=game.gameNow/1000;
        if(fog){m.uniforms.uFog.value.copy(fog.color);m.uniforms.uFogNear.value=fog.near;m.uniforms.uFogFar.value=fog.far;}
        if(ambient){m.uniforms.uSky.value.copy(ambient.color).multiplyScalar(.65);m.uniforms.uLight.value=ambient.intensity+ .45;}
        if(sun)m.uniforms.uSun.value.copy(sun.color).multiplyScalar(sun.intensity);
      });
    },
    remove(){this.group.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});this.el.removeObject3D('mesh');}
  });

  // Instanced banks keep the wetland lush without hundreds of A-Frame entities.
  AFRAME.registerComponent('wetland-bank', {
    schema:{width:{default:60},seed:{default:1}},
    init(){
      const group=new T.Group(); let seed=this.data.seed;
      const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296;};
      const dummy=new T.Object3D();
      const reedMat=new T.MeshStandardMaterial({color:'#4d6332',roughness:.9,side:T.DoubleSide});
      const reedGeo=new T.PlaneGeometry(.055,1,1,4);reedGeo.translate(0,.5,0);
      const positions=reedGeo.attributes.position;
      for(let i=0;i<positions.count;i++){const h=positions.getY(i);positions.setX(i,positions.getX(i)*(1-h*.94)+h*h*.15);}
      reedGeo.computeVertexNormals();
      const reeds=new T.InstancedMesh(reedGeo,reedMat,200);
      for(let i=0;i<200;i++){
        const x=(random()-.5)*this.data.width;
        dummy.position.set(x,-.03,(random()-.5)*.5);
        dummy.rotation.set((random()-.5)*.5,random()*Math.PI,(random()-.5)*.5);
        const h=.20+random()*.7;dummy.scale.set(1,h,1);dummy.updateMatrix();reeds.setMatrixAt(i,dummy.matrix);
        reeds.setColorAt(i,new T.Color().setHSL(.18+random()*.08,.25+random()*.2,.18+random()*.15));
      }
      group.add(reeds);
      const rockMat=new T.MeshStandardMaterial({color:'#6b6850',roughness:1});
      const rockGeo=new T.IcosahedronGeometry(1,1);const rocks=new T.InstancedMesh(rockGeo,rockMat,36);
      for(let i=0;i<36;i++){
        dummy.position.set((random()-.5)*this.data.width,-.12,(random()-.5)*.3);
        dummy.rotation.set(random(),random()*6,random());dummy.scale.set(.12+random()*.3,.1+random()*.13,.1+random()*.25);
        dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);
      }
      group.add(rocks);this.el.setObject3D('mesh',group);this.group=group;
    },
    remove(){this.group.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();if(o.dispose)o.dispose();}});this.el.removeObject3D('mesh');}
  });
})();
