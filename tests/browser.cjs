/* Run with Playwright installed, a local server, and optional CHROME_PATH / AFRAME_PATH. */
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async () => {
  const browser = await chromium.launch({headless:true,
    ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}),
    args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.stack));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  if(process.env.AFRAME_PATH)await page.route('https://aframe.io/releases/1.7.0/aframe.min.js',r=>r.fulfill({path:process.env.AFRAME_PATH,contentType:'application/javascript'}));
  try {
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8765');
    await page.waitForFunction(()=>document.querySelector('[frogger-game]')?.components['frogger-game']);
    await page.evaluate(()=>document.querySelector('[frogger-game]').components['frogger-game'].startGame());
    await page.waitForFunction(()=>{
      const g=document.querySelector('[frogger-game]').components['frogger-game'];
      return g.playerMarker?.components['wetland-model']?.model && g.prepopQueue.length===0 &&
        [...document.querySelectorAll('[wetland-model]')].every(e=>e.components['wetland-model']?.model);
    });
    const report=await page.evaluate(()=>{
      const g=document.querySelector('[frogger-game]').components['frogger-game'];
      g.el.sceneEl.pause();g.preStart=false;g.playerLane=6;g.playerWorldX=0;g.updatePlayerPosition();
      const frog=g.playerMarker.components['wetland-model'];
      const rest=frog.model.getObjectByName('ShinL').quaternion.clone();
      g.lastHopTime=-10000;g.hop(1,0);frog.tick(0,100);
      const midair=frog.model.position.y;
      const limbChanged=rest.angleTo(frog.model.getObjectByName('ShinL').quaternion)>.1;
      frog.tick(100,100);frog.tick(200,100);
      const landed=frog.hop===null && Math.abs(frog.model.position.y)<1e-6;
      g.lastHopTime=-10000;g.hop(-1,0);frog.tick(300,100);
      const repeated=!!frog.hop && frog.model.position.y>.1;
      frog.tick(400,100);frog.tick(500,100);
      const st=g.stages[1].laneStates.find(l=>l.isRiver);
      g.spawnCrocAt(st,0);g.spawnCrocAt(st,8);
      const flows=[...document.querySelector('[wetland-river]').components['wetland-river'].materials].map(m=>Math.sign(m.uniforms.uFlow.value));
      return {midair,limbChanged,landed,repeated,flows};
    });
    assert(report.midair>.2);assert(report.limbChanged);assert(report.landed);assert(report.repeated);
    assert.deepEqual(report.flows,[1,-1,1]);
    await page.waitForFunction(()=>[...document.querySelectorAll('[wetland-model]')].every(e=>e.components['wetland-model']?.model));
    const croc=await page.evaluate(()=>{
      const g=document.querySelector('[frogger-game]').components['frogger-game'];
      const refs=g.logs.filter(l=>l.isCroc), a=refs[0], b=refs[1];
      const ca=a.el.components['wetland-model'],cb=b.el.components['wetland-model'];
      ca.model.updateMatrixWorld(true);
      // Jaw local +Y points down its snout; y is world vertical after glTF conversion.
      const before=ca.jaw.localToWorld(new THREE.Vector3(0,1.2,0)).y;
      g.playerLane=7;g.playerWorldX=-.6;g.onLog=true;g.currentLogRef=a;
      a.mountT=0;g.gameNow=a.graceMs+20;g.tick(0,16);ca.tick(0,100);
      ca.model.updateMatrixWorld(true);
      const after=ca.jaw.localToWorld(new THREE.Vector3(0,1.2,0)).y;
      const warning=a.warned && ca.warning;
      const independent=ca.jaw!==cb.jaw && cb.jawAngle===0;
      g.resetCrocVisual(a);for(let i=0;i<4;i++)ca.tick(i*100,100);
      const reset=!ca.warning && ca.jawAngle<.01;
      // Jump from one moving platform to a known safe position on the same platform.
      g.playerWorldX=-.6;g.updatePlayerPosition();g.lastHopTime=-10000;g.hop(1,0);
      const riding=g.onLog && !g.dead;
      g.playerMarker.components['wetland-model'].tick(0,100);
      const platformArc=g.playerMarker.components['wetland-model'].model.position.y;
      g.el.sceneEl.play();
      return {warning,independent,reset,before,after,riding,platformArc};
    });
    assert(croc.warning);assert(croc.independent);assert(croc.reset);
    assert(croc.after>croc.before,`Jaw must open upwards: ${JSON.stringify(croc)}`);
    assert(croc.riding);assert(croc.platformArc>.1);
    // Capture a normally populated level (no overlapping test-only platforms).
    await page.evaluate(()=>{
      const g=document.querySelector('[frogger-game]').components['frogger-game'];
      document.querySelector('#rig').removeAttribute('animation__followfrog');
      g.clearAllStages();g.level=3;g.levelStartZ=g.getStageStartZ(3);
      g.buildStage(3);g.buildStage(4);
      g.preStart=false;g.playerLane=6;g.playerWorldX=0;g.onLog=false;g.currentLogRef=null;g.updatePlayerPosition();g.updateHud();
      const frog=g.playerMarker.components['wetland-model'];
      frog.hop=null;frog.model.position.set(0,0,0);frog.model.rotation.y=0;frog.action.time=0;frog.mixer.update(0);
      g.applyPalette(PALETTES[0]);
      document.querySelector('#camera').components['look-controls'].pitchObject.rotation.x=-.30;
    });
    await page.waitForFunction(()=>{
      const g=document.querySelector('[frogger-game]').components['frogger-game'];
      return g.prepopQueue.length===0 && [...document.querySelectorAll('[wetland-model]')].every(e=>e.components['wetland-model']?.model);
    });
    await page.waitForTimeout(500);
    await page.screenshot({path:process.env.PREVIEW_PATH || '/tmp/frogger-wetland-preview.png'});
    const cameraFade=await page.evaluate(()=>{
      const g=document.querySelector('[frogger-game]').components['frogger-game'];
      const vehicle=g.vehicles[0].el, comp=vehicle.components['wetland-model'];
      const original=vehicle.object3D.position.clone();
      const camera=g.el.sceneEl.camera.getWorldPosition(new THREE.Vector3());
      vehicle.object3D.position.set(camera.x,0,camera.z);
      for(let i=0;i<5;i++)comp.tick(i*100,100);
      const faded=comp.cameraOpacity<.01;
      vehicle.object3D.position.copy(original).addScalar(20);
      for(let i=0;i<5;i++)comp.tick(i*100,100);
      const restored=comp.cameraOpacity>.99;
      vehicle.object3D.position.copy(original);return {faded,restored};
    });
    assert(cameraFade.faded && cameraFade.restored);
    const cleanup=await page.evaluate(()=>{
      const g=document.querySelector('[frogger-game]').components['frogger-game'];
      const materials=document.querySelector('[wetland-river]').components['wetland-river'].materials;
      let disposed=0;materials.forEach(m=>m.addEventListener('dispose',()=>disposed++));
      g.clearAllStages();return {stages:Object.keys(g.stages).length,models:document.querySelectorAll('[wetland-model]').length,disposed};
    });
    assert.equal(cleanup.stages,0);assert.equal(cleanup.models,1);assert.equal(cleanup.disposed,3);
    console.log('WebGL errors',errors);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({frog:report,crocodile:croc,cameraFade,cleanup,errors},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
