/* ══════════════════════════════════════════════════════════════════════
   frogger.js — Frogger as a Games Room module (also runs standalone).

   Exposes itself through window.GamesHost.register('frogger', …). The host
   creates a ctx (root entity, rig, camera, fadeTo veil, requestExit, …) and
   drives mount → start → unmount. The game touches the outside world ONLY
   through ctx; it never dissolves/reforms the room (that is the host's job).
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

    /* ═══════════════════════════════════════════════════════════════
       FROGGER GAME — AUDIO ENGINE (Web Audio API, zero asset files)
       Head-locked stereo on purpose: a plain AudioContext renders
       correctly into the headset and the frog IS the camera focus.
       ═══════════════════════════════════════════════════════════════ */

    const AUDIO = (() => {
      let ctx = null, master, comp, sfxBus, musicBus, ambBus, noiseBuf;
      let riverGain = null, trafficGain = null, musicTimer = null;
      let nextStepTime = 0, stepIdx = 0, stepDur = 60 / 112 / 2;

      function init() {
        if (ctx) return;
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12; comp.knee.value = 24; comp.ratio.value = 4;
        comp.attack.value = 0.003; comp.release.value = 0.25;
        comp.connect(ctx.destination);
        master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp);
        sfxBus = ctx.createGain(); sfxBus.gain.value = 1.0; sfxBus.connect(master);
        musicBus = ctx.createGain(); musicBus.gain.value = 0.35; musicBus.connect(master);
        ambBus = ctx.createGain(); ambBus.gain.value = 0.8; ambBus.connect(master);
        // One shared 2 s noise buffer feeds splash, crunch, snap and both ambient beds.
        const len = ctx.sampleRate * 2;
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }

      function unlock() {
        init();
        if (ctx.state === 'suspended') ctx.resume();
      }

      document.addEventListener('visibilitychange', () => {  // Quest doff/don suspends the ctx
        if (!document.hidden && ctx && ctx.state === 'suspended') ctx.resume();
      });
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });

      // One oscillator + envelope, self-cleaning.
      function tone(o) {
        if (!ctx) return;
        const t = ctx.currentTime + Math.max(0, o.when || 0);
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = o.type;
        osc.frequency.setValueAtTime(o.f0, t);
        if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(o.g, t + (o.at || 0.005));
        g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
        osc.connect(g).connect(o.bus || sfxBus);
        osc.start(t); osc.stop(t + o.dur + 0.05);
        osc.onended = () => { osc.disconnect(); g.disconnect(); };
      }

      // Filtered noise burst from the shared buffer.
      function noise(o) {
        if (!ctx) return;
        const t = ctx.currentTime + Math.max(0, o.when || 0);
        const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = o.type || 'lowpass'; f.Q.value = o.Q || 1;
        f.frequency.setValueAtTime(o.f0, t);
        if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(o.g, t + (o.at || 0.005));
        g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
        src.connect(f).connect(g).connect(sfxBus);
        src.start(t); src.stop(t + o.dur + 0.05);
        src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
      }

      // ── SFX ──
      function sfxHop() {
        const p = 1 + (Math.random() - 0.5) * 0.12;  // ±6% pitch so hops don't machine-gun
        tone({ type: 'triangle', f0: 300 * p, f1: 620 * p, dur: 0.09, g: 0.22 });
      }
      function sfxLand() {
        tone({ type: 'sine', f0: 150, f1: 65, dur: 0.13, g: 0.30 });
        noise({ f0: 420, dur: 0.05, g: 0.12 });
      }
      function sfxSplash() {
        noise({ f0: 2200, f1: 300, dur: 0.55, g: 0.40, at: 0.01 });
        tone({ type: 'sine', f0: 320, f1: 70, dur: 0.40, g: 0.18, when: 0.03 });
      }
      function sfxVehicleHit() {
        tone({ type: 'sine', f0: 90, f1: 35, dur: 0.28, g: 0.50 });
        noise({ type: 'bandpass', f0: 200, Q: 1, dur: 0.15, g: 0.30 });
        [350, 440].forEach(f =>
          tone({ type: 'sawtooth', f0: f, dur: 0.45, g: 0.10, at: 0.04, when: 0.05 }));
      }
      function sfxCrocWarn() {
        if (!ctx) return;
        const t = ctx.currentTime;
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 48;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.18, t + 0.08);
        g.gain.setTargetAtTime(0.0001, t + 0.5, 0.08);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 9;  // throat flutter
        const lfoG = ctx.createGain();
        // Envelope the LFO depth too, or it holds the gain at ~0.1 when the
        // oscillator hard-stops at t+0.7 — an audible pop every warning growl.
        lfoG.gain.setValueAtTime(0.09, t);
        lfoG.gain.setTargetAtTime(0.0001, t + 0.5, 0.08);
        lfo.connect(lfoG).connect(g.gain);
        osc.connect(f).connect(g).connect(sfxBus);
        osc.start(t); lfo.start(t); osc.stop(t + 0.7); lfo.stop(t + 0.7);
        osc.onended = () => { osc.disconnect(); f.disconnect(); g.disconnect(); lfoG.disconnect(); };
      }
      function sfxCrocSnap() {
        noise({ type: 'highpass', f0: 2000, dur: 0.03, g: 0.55, at: 0.002 });
        tone({ type: 'sine', f0: 120, f1: 45, dur: 0.10, g: 0.45, when: 0.015 });
      }
      let lastTick = 0;
      function sfxScoreTick() {
        const now = performance.now();
        if (now - lastTick < 60) return;  // throttle rapid point streams
        lastTick = now;
        tone({ type: 'sine', f0: 1046.5, dur: 0.07, g: 0.12 });
        tone({ type: 'sine', f0: 2093, dur: 0.05, g: 0.05 });
      }
      function sfxGoal() {  // rising arpeggio C5-E5-G5-C6
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          tone({ type: 'square', f0: f, dur: i === 3 ? 0.35 : 0.12, g: 0.11, when: i * 0.08 }));
      }
      function sfxLevelUp() {
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
          tone({ type: 'triangle', f0: f, dur: 0.14, g: 0.14, when: i * 0.10 }));
        tone({ type: 'square', f0: 130.81, dur: 0.55, g: 0.09 });
      }
      function sfxGameOver() {  // descending G4-E4-C4-G3, last note droops
        [392, 329.63, 261.63, 196].forEach((f, i) =>
          tone({ type: 'sawtooth', f0: f, f1: i === 3 ? f * 0.94 : undefined,
                 dur: i === 3 ? 0.5 : 0.16, g: 0.15, when: i * 0.17 }));
      }
      function sfxSparkle() {  // new-high-score glissando
        for (let i = 0; i < 12; i++)
          tone({ type: 'sine', f0: 1200 * Math.pow(3800 / 1200, i / 11),
                 dur: 0.05, g: 0.07, when: i * 0.035 });
        tone({ type: 'triangle', f0: 1568, dur: 0.5, g: 0.05, when: 0.15 });
        tone({ type: 'triangle', f0: 1573, dur: 0.5, g: 0.05, when: 0.15 });  // 5 Hz beat shimmer
      }

      // ── Ambient beds: river wash + traffic rumble, crossfaded by zone ──
      function startAmbience() {
        if (!ctx) return;
        ambBus.gain.setTargetAtTime(0.8, ctx.currentTime, 0.5);
        if (riverGain) { updateAmbience('safe'); return; }
        riverGain = ctx.createGain(); riverGain.gain.value = 0;
        const rSrc = ctx.createBufferSource(); rSrc.buffer = noiseBuf; rSrc.loop = true;
        const rF = ctx.createBiquadFilter(); rF.type = 'lowpass'; rF.frequency.value = 500;
        const rLfo = ctx.createOscillator(); rLfo.frequency.value = 0.15;  // lapping wander
        const rLfoG = ctx.createGain(); rLfoG.gain.value = 150;
        rLfo.connect(rLfoG).connect(rF.frequency);
        rSrc.connect(rF).connect(riverGain).connect(ambBus);
        rSrc.start(); rLfo.start();

        trafficGain = ctx.createGain(); trafficGain.gain.value = 0;
        const tSrc = ctx.createBufferSource(); tSrc.buffer = noiseBuf; tSrc.loop = true;
        const tF = ctx.createBiquadFilter(); tF.type = 'lowpass'; tF.frequency.value = 120;
        tSrc.connect(tF).connect(trafficGain);
        const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 42;
        const humG = ctx.createGain(); humG.gain.value = 0.05;
        const swell = ctx.createOscillator(); swell.frequency.value = 0.08;  // passing-traffic swell
        const swellG = ctx.createGain(); swellG.gain.value = 0.03;
        swell.connect(swellG).connect(humG.gain);
        hum.connect(humG).connect(trafficGain);
        trafficGain.connect(ambBus);
        tSrc.start(); hum.start(); swell.start();
        updateAmbience('safe');
      }

      function updateAmbience(zone) {  // 'road' | 'river' | 'mid' | 'safe'
        if (!ctx || !trafficGain) return;
        const w = { road: [1.0, 0.15], river: [0.15, 1.0], mid: [0.5, 0.5], safe: [0.4, 0.3] }[zone] || [0.4, 0.3];
        trafficGain.gain.setTargetAtTime(w[0] * 0.55, ctx.currentTime, 0.8);
        riverGain.gain.setTargetAtTime(w[1] * 0.45, ctx.currentTime, 0.8);
      }

      function stopAmbience() {
        if (!ctx) return;
        ambBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
      }

      // ── Music: 2-bar chiptune loop, lookahead-scheduled off ctx.currentTime ──
      const LEAD = [523.25, 0, 659.25, 523.25, 587.33, 0, 783.99, 0,
                    698.46, 0, 659.25, 587.33, 523.25, 0, 392.00, 0];
      const BASS = [130.81, 0, 196.00, 0, 130.81, 0, 196.00, 0,
                    174.61, 0, 130.81, 0, 196.00, 98.00, 130.81, 0];

      function setTempoForLevel(lvl) { stepDur = 60 / Math.min(112 + (lvl - 1) * 3, 145) / 2; }

      function startMusic() {
        if (!ctx || musicTimer) return;
        musicBus.gain.setValueAtTime(0.35, ctx.currentTime);
        nextStepTime = ctx.currentTime + 0.1; stepIdx = 0;
        musicTimer = setInterval(() => {  // 40 ms tick, 150 ms lookahead — survives frame hitches
          while (nextStepTime < ctx.currentTime + 0.15) {
            const i = stepIdx % 16, when = nextStepTime - ctx.currentTime;
            if (LEAD[i]) tone({ type: 'square', f0: LEAD[i], dur: stepDur * 0.85, g: 0.10, at: 0.01, when, bus: musicBus });
            if (BASS[i]) tone({ type: 'triangle', f0: BASS[i], dur: stepDur * 0.90, g: 0.16, at: 0.01, when, bus: musicBus });
            nextStepTime += stepDur; stepIdx++;
          }
        }, 40);
      }
      function stopMusic() { clearInterval(musicTimer); musicTimer = null; }
      function duckMusic() { if (ctx) musicBus.gain.setTargetAtTime(0.06, ctx.currentTime, 0.05); }
      function restoreMusic() { if (ctx) musicBus.gain.setTargetAtTime(0.35, ctx.currentTime, 0.4); }

      // Silence everything when the game unmounts — no lingering music/ambience
      // bleeding into the lobby. The context itself stays alive for reuse.
      function stopAll() {
        stopMusic();
        stopAmbience();
        if (ctx) musicBus.gain.setValueAtTime(0.35, ctx.currentTime);  // reset for next session
      }

      return { unlock, startAmbience, updateAmbience, stopAmbience, stopAll,
               startMusic, stopMusic, setTempoForLevel, duckMusic, restoreMusic,
               sfxHop, sfxLand, sfxSplash, sfxVehicleHit, sfxCrocWarn, sfxCrocSnap,
               sfxScoreTick, sfxGoal, sfxLevelUp, sfxGameOver, sfxSparkle };
    })();

    /* ═══════════════════════════════════════════════════════════════
       FROGGER GAME — day/dusk/night palettes
       World surfaces are lit standard materials, so the palette shift
       re-tints everything through the two scene lights; only sky, fog
       and vehicle-light emissives are driven explicitly.
       ═══════════════════════════════════════════════════════════════ */

    const PALETTES = [
      { // DAY
        skyTop: '#4a9edd', skyHorizon: '#bfe3f5',
        fog: '#bfe3f5', fogNear: 25, fogFar: 65,
        ambColor: '#ffffff', ambInt: 0.60,
        dirColor: '#fff2cc', dirInt: 0.55,
        headlight: 0.15, taillight: 0.30
      },
      { // DUSK
        skyTop: '#3b3f7a', skyHorizon: '#f2a65e',
        fog: '#cc7a52', fogNear: 22, fogFar: 60,
        ambColor: '#ffc4a3', ambInt: 0.45,
        dirColor: '#ff8f5a', dirInt: 0.40,
        headlight: 1.0, taillight: 0.9
      },
      { // NIGHT
        skyTop: '#0b1030', skyHorizon: '#1c2a55',
        fog: '#101830', fogNear: 18, fogFar: 55,
        ambColor: '#8899dd', ambInt: 0.28,
        dirColor: '#b8c8f0', dirInt: 0.22,
        headlight: 1.6, taillight: 1.3
      }
    ];

    /* ═══════════════════════════════════════════════════════════════
       FROGGER GAME
       ═══════════════════════════════════════════════════════════════ */

    if (!AFRAME.components['frogger-game']) AFRAME.registerComponent('frogger-game', {
      schema: {
        laneWidth: { default: 3.5 },
        roadLanes: { default: 5 },
        riverLanes: { default: 3 },
        roadExtent: { default: 30 },
        startZ: { default: -3 }
      },

      init: function () {
        this.active = false;
        this.vehicles = [];
        this.logs = [];               // logs AND crocs (crocs carry isCroc: true)
        this.playerLane = -1;
        this.playerWorldX = 0;        // actual world X (tracks platform drift)
        this.lastHopTime = 0;
        this.playerMarker = null;
        this.dead = false;
        this.gameOver = false;
        this.preStart = true;
        this.rigFollowOffset = 3;
        this.level = 1;
        this.onLog = false;
        this.currentLogRef = null;
        this.levelLabel = null;
        this.levelStartZ = this.data.startZ;
        this.stages = {};             // stageLevel -> { el, laneStates, cfg }
        this.band = 0;                // palette band index (0 day, 1 dusk, 2 night)
        this.rippleTexs = new Set();  // water overlay textures, scrolled in tick
        this.gameNow = 0;             // accumulated (clamped) game time, ms — pause-safe
        this.prepopQueue = [];        // lane pre-population jobs, drained one per tick

        // Scoring / lives
        this.score = 0;
        this.lives = 3;
        this.maxLaneReached = 0;      // per-attempt forward-progress marker (anti point farming)
        this.levelStartTime = 0;
        try {
          this.highScore = parseInt(localStorage.getItem('froggerHighScore') || '0', 10);
        } catch (e) { this.highScore = 0; }

        this.leftStick = { x: 0, y: 0 };
        this.stickArmed = true;       // edge-trigger latch: one flick = one hop

        // Lifecycle bookkeeping — cleared on unmount so nothing leaks across
        // repeated Games Room sessions.
        this.timers = [];             // setTimeout ids
        this.disposers = [];          // event-listener removers
        this.mounted = false;
        this.ctx = null;
        this.root = null;
      },

      // ─── HELPERS: tracked listeners + timeouts (cleaned on unmount) ──
      addListener: function (target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        this.disposers.push(() => target.removeEventListener(type, fn, opts));
      },
      setT: function (fn, ms) {
        const id = setTimeout(() => {
          this.timers = this.timers.filter(t => t !== id);
          if (this.mounted) fn();
        }, ms);
        this.timers.push(id);
        return id;
      },

      // ─── DIFFICULTY CURVE ──────────────────────────────────────────
      // Deterministic hash in [0,1) — replaces Math.random() in balance
      // code so a level always plays the same and no roll is unwinnable.
      hash01: function (a, b, c) {
        const s = Math.sin(a * 127.1 + b * 311.7 + (c || 0) * 74.7) * 43758.5453;
        return s - Math.floor(s);
      },

      // Single source of truth for all tuning numbers.
      // Safety is expressed in TIME: every road gap is speed*window + frog
      // slab, so the frog's column is clear for exactly `window` seconds
      // regardless of vehicle speed or size. The floor is 1.4 s.
      getLevelConfig: function (lvl) {
        const H = (a, b, c) => this.hash01(a, b, c);
        // 1.8 coefficient (not 2.2): early levels stay easy via the wide time
        // window, but slightly faster cars mean longer gaps and ~15% fewer
        // entities — the difference between "traffic" and "a wall of traffic".
        const roadBase = 3.4 - 1.8 * Math.pow(0.82, lvl - 1);      // asymptote 3.4 u/s
        const riverBase = 2.4 - 1.4 * Math.pow(0.85, lvl - 1);     // asymptote 2.4 u/s
        const window = Math.max(1.4, 3.2 - 0.2 * (lvl - 1));       // clear-window seconds
        const truckShare = Math.min(0.10 + 0.06 * (lvl - 1), 0.40);
        const rushLane = lvl >= 4 ? (lvl * 2 + 3) % this.data.roadLanes : -1;

        const colors = ['#e63946', '#457b9d', '#f4a261', '#2a9d8f', '#9b5de5'];
        const road = [];
        for (let i = 0; i < this.data.roadLanes; i++) {
          const isRush = i === rushLane;
          const speed = Math.min(roadBase * (0.85 + 0.30 * H(lvl, i, 1)) * (isRush ? 1.6 : 1), 5.0);
          road.push({
            dir: i % 2 === 0 ? 1 : -1,
            speed,
            gapDist: speed * window + 0.8,          // rear→front gap ⇒ exactly `window` s clear
            truckShare: isRush ? truckShare * 0.5 : truckShare,
            isRush,
            phase: H(lvl, i, 2),
            color: colors[i % colors.length]
          });
        }

        const logLen = Math.max(3.6, 8.5 - 0.5 * (lvl - 1));
        const baseGap = Math.min(2.2 + 0.35 * (lvl - 1), 5.0);
        const crocShare = lvl >= 3 ? Math.min(0.12 * (lvl - 2), 0.5) : 0;
        const graceMs = Math.max(2500, 4000 - 250 * (lvl - 3));

        const river = [];
        for (let i = 0; i < this.data.riverLanes; i++) {
          const speed = riverBase * (0.90 + 0.20 * H(lvl, i, 3));
          river.push({
            dir: i % 2 === 0 ? 1 : -1,
            speed,
            logLen,
            gapDist: Math.min(baseGap, 2.5 * speed),  // worst-case wait for a platform ≤ 2.5 s
            crocShare,
            graceMs,
            warnMs: 1500,                             // fixed: reaction time is a fairness anchor
            phase: H(lvl, i, 4)
          });
        }

        return { road, river };
      },

      getBand: function (lvl) { return Math.floor((lvl - 1) / 2) % 3; },  // 2 levels per band

      // ─── ZONE HELPERS ───────────────────────────────────────────────
      // Layout: start safe → road lanes → mid safe → river lanes → goal safe
      totalLanes: function () {
        return this.data.roadLanes + this.data.riverLanes + 2; // +2 for mid safe + goal
      },

      levelDepth: function () {
        return this.totalLanes() * this.data.laneWidth;
      },

      getStageStartZ: function (stageLevel) {
        return this.data.startZ - (stageLevel - 1) * this.levelDepth();
      },

      isRoadLane: function (lane) {
        return lane >= 1 && lane <= this.data.roadLanes;
      },

      isMidSafe: function (lane) {
        return lane === this.data.roadLanes + 1;
      },

      isRiverLane: function (lane) {
        const first = this.data.roadLanes + 2;
        return lane >= first && lane <= first + this.data.riverLanes - 1;
      },

      riverLaneIndex: function (lane) {
        return lane - (this.data.roadLanes + 2);
      },

      isGoalLane: function (lane) {
        return lane >= this.data.roadLanes + this.data.riverLanes + 2;
      },

      laneToZ: function (lane) {
        return this.levelStartZ - (lane - 0.5) * this.data.laneWidth;
      },

      zoneOf: function (lane) {
        if (this.isRoadLane(lane)) return 'road';
        if (this.isRiverLane(lane)) return 'river';
        if (this.isMidSafe(lane)) return 'mid';
        return 'safe';
      },

      // ─── INPUT ──────────────────────────────────────────────────────
      setupInput: function () {
        const leftHand = this.ctx.leftHand;
        if (leftHand) {
          this.addListener(leftHand, 'thumbstickmoved', event => {
            if (!this.active) return;
            this.leftStick.x = event.detail.x || 0;
            this.leftStick.y = event.detail.y || 0;
          });
        }
        this.addListener(window, 'keydown', e => {
          if (!this.active || this.dead || this.gameOver) return;
          if (e.key === 'ArrowUp') this.hop(0, -1);
          else if (e.key === 'ArrowDown') this.hop(0, 1);
          else if (e.key === 'ArrowLeft') this.hop(-1, 0);
          else if (e.key === 'ArrowRight') this.hop(1, 0);
        });
      },

      // ─── MOUNT / START / UNMOUNT (Games Room lifecycle) ─────────────
      // The host has already dissolved the room and dropped a black veil, so
      // we build the ENTIRE world here (hidden behind the veil); start() then
      // reveals play. No 600 ms wait — the veil covers the build.
      mount: function (ctx) {
        this.ctx = ctx;
        this.root = ctx.root;
        this.mounted = true;

        this.active = true;
        this.dead = false;
        this.gameOver = false;
        this.preStart = true;
        this.playerLane = -1;
        this.playerWorldX = 0;
        this.onLog = false;
        this.currentLogRef = null;
        this.level = 1;
        this.levelStartZ = this.data.startZ;
        this.band = 0;
        this.palT = undefined;
        this.score = 0;
        this.lives = 3;
        this.maxLaneReached = 0;
        this.gameNow = 0;
        this.leftStick = { x: 0, y: 0 };
        this.stickArmed = false;  // stick must pass through centre before the first hop

        if (ctx.rig) {
          this.spawnX = ctx.rig.object3D.position.x;
          this.spawnZ = ctx.rig.object3D.position.z;
          ctx.rig.object3D.rotation.set(0, 0, 0);
        } else { this.spawnX = 0; this.spawnZ = 0; }
        // Arrow keys also drive wasd-controls on the camera, which would drift
        // the camera off the rig with every hop — freeze it while we play.
        if (ctx.camera) {
          ctx.camera.setAttribute('wasd-controls', 'enabled', false);
          ctx.camera.object3D.position.set(0, 1.6, 0);
        }

        this.setupInput();
        this.addListener(this.el.sceneEl, 'enter-vr', () => AUDIO.unlock());

        this.makeTextures();
        this.buildAtmosphere();
        this.buildStage(1);
        this.buildStage(2);
        this.rebuildPlayerMarker();
        this.buildHud();
        this.hudRoot.setAttribute('visible', 'true');
        this.updateHud();
        this.updatePlayerPosition();
      },

      start: function () {
        // Called by the host once the arrival veil has cleared.
        AUDIO.unlock();
        AUDIO.startAmbience();
        AUDIO.startMusic();
        AUDIO.setTempoForLevel(1);
        this.levelStartTime = performance.now();
        this.showLevelLabel();
      },

      pauseGame: function () { AUDIO.duckMusic(); },
      resumeGame: function () { AUDIO.restoreMusic(); },

      unmount: function () {
        this.mounted = false;
        this.active = false;
        this.dead = false;
        this.gameOver = false;
        this.onLog = false;
        this.currentLogRef = null;

        AUDIO.stopAll();
        this.timers.forEach(clearTimeout); this.timers = [];
        this.disposers.forEach(d => d()); this.disposers = [];

        this.clearAllStages();
        // Camera-attached UI lives outside ctx.root — remove it explicitly.
        [this.hudRoot, this.gameOverRoot].forEach(el => { if (el && el.parentNode) el.parentNode.removeChild(el); });
        this.hudRoot = null; this.gameOverRoot = null;
        // Everything else (marker, sky, ground, popups, confetti, label) is
        // under ctx.root, which the host removes — just drop our refs.
        this.playerMarker = null; this.skyEl = null; this.groundEl = null;
        this.hopPopup = null; this.bonusPopup = null; this.confettiRoot = null;
        this.levelLabel = null; this.jumpWarn = null;
        this.rippleTexs.clear();
        this.prepopQueue = [];

        // Undo our atmosphere so the host's lobby is clean.
        const scene = this.el.sceneEl;
        scene.removeAttribute('fog');
        if (this._prevBg != null) scene.setAttribute('background', this._prevBg);
        // The rig-follow animation lives on the SHARED lobby rig — strip it.
        if (this.ctx && this.ctx.rig) this.ctx.rig.removeAttribute('animation__followfrog');
        if (this.ctx && this.ctx.camera) {
          this.ctx.camera.setAttribute('wasd-controls', 'enabled', true);
          this.ctx.camera.object3D.position.set(0, 1.6, 0);
        }
        // Remove the canvas-texture holder so a remount regenerates cleanly.
        const holder = document.getElementById('froggerAssets');
        if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
        if (this.hazardTex) { this.hazardTex.dispose(); this.hazardTex = null; }
      },

      // Build the game's own sky, fog, ground and starting palette. (In the
      // old single-file build this was folded into the room dissolve.)
      buildAtmosphere: function () {
        const scene = this.el.sceneEl;
        this._prevBg = scene.getAttribute('background');
        scene.setAttribute('background', 'color: #bfe3f5');

        const sky = document.createElement('a-sky');
        sky.setAttribute('radius', 400);
        sky.setAttribute('material', 'shader: flat; fog: false; src: #skyCanvas');
        this.root.appendChild(sky);
        this.skyEl = sky;

        // The game's own ground plane (no longer borrows the room floor).
        const ground = document.createElement('a-plane');
        ground.setAttribute('rotation', '-90 0 0');
        ground.setAttribute('width', 140);
        ground.setAttribute('height', 500);
        ground.setAttribute('position', '0 -0.05 -220');
        ground.setAttribute('color', '#3d6b31');
        ground.setAttribute('roughness', 1);
        this.root.appendChild(ground);
        this.groundEl = ground;

        if (this.ctx.dirLight) this.ctx.dirLight.setAttribute('position', '-15 30 10');
        this.applyPalette(PALETTES[0]);
      },

      // ─── STAGES ────────────────────────────────────────────────────
      buildStage: function (stageLevel) {
        if (this.stages[stageLevel]) return;
        const el = document.createElement('a-entity');
        el.setAttribute('id', 'froggerStage-' + stageLevel);
        this.root.appendChild(el);

        const sz = this.getStageStartZ(stageLevel);
        const cfg = this.getLevelConfig(stageLevel);
        const lw = this.data.laneWidth;

        // Per-lane spawner state. Spawning is distance-scheduled from tick
        // (no timers): exact gaps, and everything pauses coherently with RAF.
        const laneStates = [];
        cfg.road.forEach((laneCfg, i) => {
          laneStates.push({
            cfg: laneCfg, isRiver: false, laneIdx: i, lvl: stageLevel,
            laneZ: sz - (i + 0.5) * lw, stageLevel,
            count: 0, prevWasCroc: false, travel: 0, need: 0, next: null
          });
        });
        cfg.river.forEach((laneCfg, i) => {
          laneStates.push({
            cfg: laneCfg, isRiver: true, laneIdx: i, lvl: stageLevel,
            laneZ: sz - (this.data.roadLanes + 1 + i + 0.5) * lw, stageLevel,
            count: 0, prevWasCroc: false, travel: 0, need: 0, next: null
          });
        });

        const stageObj = { el, laneStates, cfg, level: stageLevel };
        this.stages[stageLevel] = stageObj;

        this.createStageWorld(el, sz, stageLevel, cfg);
        // Pre-population creates ~60 entities per lane-set; spread it one lane
        // per frame (drained in tick) so level transitions don't stall a frame.
        laneStates.forEach(st => this.prepopQueue.push({ stage: stageObj, st }));
      },

      removeStage: function (stageLevel) {
        const stage = this.stages[stageLevel];
        if (!stage) return;
        this.prepopQueue = this.prepopQueue.filter(job => job.st.stageLevel !== stageLevel);
        if (stage.rippleTex) this.rippleTexs.delete(stage.rippleTex);
        if (stage.el && stage.el.parentNode) stage.el.parentNode.removeChild(stage.el);
        this.vehicles = this.vehicles.filter(v => {
          if (v.stageLevel === stageLevel) { if (v.el.parentNode) v.el.parentNode.removeChild(v.el); return false; }
          return true;
        });
        this.logs = this.logs.filter(l => {
          if (l.stageLevel === stageLevel) { if (l.el.parentNode) l.el.parentNode.removeChild(l.el); return false; }
          return true;
        });
        delete this.stages[stageLevel];
      },

      clearAllStages: function () {
        Object.keys(this.stages).forEach(k => this.removeStage(parseInt(k)));
        this.vehicles = [];
        this.logs = [];
      },

      // ─── PROCEDURAL TEXTURES (canvas, all generated once) ──────────
      makeTextures: function () {
        if (document.getElementById('froggerAssets')) return;
        const holder = document.createElement('div');
        holder.id = 'froggerAssets';
        holder.style.display = 'none';
        document.body.appendChild(holder);
        const mk = (id, w, h, draw) => {
          const c = document.createElement('canvas');
          c.id = id; c.width = w; c.height = h;
          draw(c.getContext('2d'), w, h);
          holder.appendChild(c);
        };
        const rnd = Math.random;

        mk('skyCanvas', 16, 256, g => this.paintSky(g, PALETTES[0].skyTop, PALETTES[0].skyHorizon));

        mk('roadCanvas', 1024, 512, (g, w, h) => {
          g.fillStyle = '#3a3a3e'; g.fillRect(0, 0, w, h);
          const specks = ['#2f2f33', '#46464b', '#55555a'];
          g.globalAlpha = 0.6;
          for (let i = 0; i < 4000; i++) {
            g.fillStyle = specks[(rnd() * 3) | 0];
            g.fillRect(rnd() * w, rnd() * h, 1 + rnd(), 1 + rnd());
          }
          g.globalAlpha = 1;
          const laneH = h / 5;
          for (let l = 0; l < 5; l++) {          // tyre-wear bands
            const cy = (l + 0.5) * laneH;
            g.fillStyle = 'rgba(0,0,0,0.10)';
            g.fillRect(0, cy - 28 - 7, w, 14);
            g.fillRect(0, cy + 28 - 7, w, 14);
          }
          g.fillStyle = '#e8e8e8';               // dashed dividers
          for (let l = 1; l < 5; l++) {
            const y = l * laneH;
            for (let x = 0; x < w; x += 76) g.fillRect(x, y - 2.5, 46, 5);
          }
          g.fillStyle = '#f0c419';               // edge lines
          g.fillRect(0, 6, w, 7);
          g.fillRect(0, h - 13, w, 7);
        });

        mk('grassCanvas', 512, 512, (g, w, h) => {
          g.fillStyle = '#4a8f3c'; g.fillRect(0, 0, w, h);
          const blades = ['#3e7a32', '#5aa348', '#6db554'];
          for (let i = 0; i < 3000; i++) {
            g.fillStyle = blades[(rnd() * 3) | 0];
            g.fillRect(rnd() * w, rnd() * h, 1, 3);
          }
          g.fillStyle = '#7cc76a';
          for (let i = 0; i < 150; i++) g.fillRect(rnd() * w, rnd() * h, 1, 3);
          g.fillStyle = 'rgba(61,48,32,0.15)';
          for (let i = 0; i < 40; i++) {
            g.beginPath(); g.arc(rnd() * w, rnd() * h, 3 + rnd() * 3, 0, 7); g.fill();
          }
        });

        mk('rippleCanvas', 256, 256, (g, w, h) => {
          g.clearRect(0, 0, w, h);
          for (let i = 0; i < 40; i++) {         // wobbly strokes, endpoints matched so it tiles
            const y = rnd() * h;
            g.strokeStyle = 'rgba(255,255,255,0.22)';
            g.lineWidth = 2 + rnd();
            g.beginPath(); g.moveTo(0, y);
            for (let s = 1; s <= 8; s++) g.lineTo((w / 8) * s, s === 8 ? y : y + (rnd() - 0.5) * 8);
            g.stroke();
          }
          g.strokeStyle = 'rgba(255,255,255,0.45)';
          for (let i = 0; i < 12; i++) {         // bright glints
            const x = rnd() * (w - 20), y = rnd() * h;
            g.lineWidth = 2;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + 12 + rnd() * 8, y); g.stroke();
          }
        });

        mk('barkCanvas', 256, 256, (g, w, h) => {
          g.fillStyle = '#6e4a2f'; g.fillRect(0, 0, w, h);
          const streaks = ['#543722', '#7d5a3a'];
          for (let i = 0; i < 60; i++) {
            const y = rnd() * h;
            g.strokeStyle = streaks[i % 2];
            g.lineWidth = 2 + rnd() * 2;
            g.beginPath(); g.moveTo(0, y);
            for (let s = 1; s <= 6; s++) g.lineTo((w / 6) * s, s === 6 ? y : y + (rnd() - 0.5) * 6);
            g.stroke();
          }
          for (let i = 0; i < 6; i++) {          // knots
            const x = rnd() * w, y = rnd() * h;
            g.fillStyle = '#4a2f1c';
            g.beginPath(); g.ellipse(x, y, 8, 5, 0, 0, 7); g.fill();
            g.fillStyle = '#3a2414';
            g.beginPath(); g.ellipse(x, y, 4, 2.5, 0, 0, 7); g.fill();
          }
        });

        mk('logEndCanvas', 128, 128, (g, w, h) => {
          g.fillStyle = '#d9b38c'; g.fillRect(0, 0, w, h);
          g.strokeStyle = '#b08d63'; g.lineWidth = 2;
          [12, 24, 36, 48, 58].forEach(r => {
            g.beginPath(); g.arc(64, 64, r, 0, 7); g.stroke();
          });
          g.fillStyle = '#8a6a48';
          g.beginPath(); g.arc(64, 64, 4, 0, 7); g.fill();
        });

        mk('glassCanvas', 256, 128, (g, w, h) => {
          g.fillStyle = '#202833'; g.fillRect(0, 0, w, h);
          const grad = g.createLinearGradient(0, 0, 0, h / 3);
          grad.addColorStop(0, '#3d4d63'); grad.addColorStop(1, '#202833');
          g.fillStyle = grad; g.fillRect(0, 0, w, h / 3);
          g.fillStyle = '#0f1319';
          [0, 122, 246].forEach(x => g.fillRect(x, 0, 10, h));
          g.fillRect(0, 0, w, 8);                // roofline strip
        });

        mk('treelineCanvas', 1024, 256, (g, w, h) => {
          g.clearRect(0, 0, w, h);
          g.fillStyle = '#7d95ad';               // back hills (periods divide 1024 → tiles)
          g.beginPath(); g.moveTo(0, h);
          for (let x = 0; x <= w; x += 8)
            g.lineTo(x, 130 - 22 * Math.sin(x / 163) - 12 * Math.sin(x / 71 + 2));
          g.lineTo(w, h); g.closePath(); g.fill();
          g.fillStyle = '#33523d';               // treeline crowns
          for (let x = 0; x <= w; x += 30) {
            const r = 18 + this.hash01(x, 7, 1) * 16;
            g.beginPath(); g.arc(x, 185, r, 0, 7); g.fill();
          }
          g.fillRect(0, 185, w, h - 185);
          g.fillStyle = '#26402f';               // trunk hints
          for (let i = 0; i < 25; i++) g.fillRect(rnd() * w, 190, 2, 14);
        });

        mk('lilyCanvas', 128, 128, (g, w, h) => {
          g.clearRect(0, 0, w, h);
          g.fillStyle = '#3f9e5f';
          g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill();
          g.globalCompositeOperation = 'destination-out';  // wedge notch
          g.beginPath(); g.moveTo(64, 64);
          g.arc(64, 64, 60, -0.35, 0.35); g.closePath(); g.fill();
          g.globalCompositeOperation = 'source-over';
          g.strokeStyle = '#2e7d48'; g.lineWidth = 2;
          for (let i = 0; i < 8; i++) {          // radial veins
            const a = 0.6 + i * 0.65;
            g.beginPath(); g.moveTo(64, 64);
            g.lineTo(64 + Math.cos(a) * 54, 64 + Math.sin(a) * 54); g.stroke();
          }
          g.strokeStyle = '#58b976'; g.lineWidth = 3;
          g.beginPath(); g.arc(64, 64, 56, 0.5, 5.9); g.stroke();
        });

        mk('crocHideCanvas', 256, 128, (g, w, h) => {
          g.fillStyle = '#3e6b35'; g.fillRect(0, 0, w, h);
          g.fillStyle = '#2e5226';
          [30, 64, 98].forEach((y, row) => {     // scute bumps
            for (let x = row % 2 ? 10 : 0; x < w; x += 20) {
              g.beginPath();
              if (g.roundRect) g.roundRect(x, y - 4, 14, 8, 3); else g.rect(x, y - 4, 14, 8);
              g.fill();
            }
          });
          g.fillStyle = 'rgba(20,40,16,0.3)';
          for (let i = 0; i < 200; i++) g.fillRect(rnd() * w, rnd() * h, 1 + rnd(), 1 + rnd());
          g.fillStyle = '#e8e4d4';               // tooth zigzag along the bottom edge
          for (let x = 0; x < w; x += 10) {
            g.beginPath();
            g.moveTo(x, h); g.lineTo(x + 5, h - 14); g.lineTo(x + 10, h); g.closePath(); g.fill();
          }
        });

        // Hazard-stripe boundary texture (THREE.CanvasTexture, shared by all walls)
        const c = document.createElement('canvas'); c.width = 256; c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#7f1d1d'; g.fillRect(0, 0, 256, 256);
        g.strokeStyle = '#fbbf24'; g.lineWidth = 26;
        for (let x = -256; x < 512; x += 96) {
          g.beginPath(); g.moveTo(x, 256); g.lineTo(x + 256, 0); g.stroke();
        }
        g.globalCompositeOperation = 'destination-out';  // fade top → transparent
        const fade = g.createLinearGradient(0, 0, 0, 256);
        fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.65, 'rgba(0,0,0,0)');
        g.fillStyle = fade; g.fillRect(0, 0, 256, 256);
        this.hazardTex = new THREE.CanvasTexture(c);
        this.hazardTex.colorSpace = THREE.SRGBColorSpace;  // hand-built textures skip A-Frame's color correction
        this.hazardTex.wrapS = THREE.RepeatWrapping;
        this.hazardTex.repeat.set(6, 1);
      },

      paintSky: function (g, top, horizon) {
        const grad = g.createLinearGradient(0, 0, 0, 200);
        grad.addColorStop(0, top); grad.addColorStop(1, horizon);
        g.fillStyle = grad; g.fillRect(0, 0, 16, 200);
        g.fillStyle = horizon; g.fillRect(0, 200, 16, 56);
      },

      redrawSky: function (top, horizon) {
        const c = document.getElementById('skyCanvas');
        if (!c) return;
        this.paintSky(c.getContext('2d'), top, horizon);
        const mesh = this.skyEl && this.skyEl.getObject3D('mesh');
        if (mesh && mesh.material.map) mesh.material.map.needsUpdate = true;
      },

      // Set a light via BOTH the attribute and the THREE object: the palette
      // lerp mutates THREE directly, so attribute-diffing alone can skip the
      // update and leave a stale colour behind.
      setLight: function (el, type, color, intensity) {
        if (!el) return;
        el.setAttribute('light', `type: ${type}; color: ${color}; intensity: ${intensity}`);
        if (el.components.light && el.components.light.light) {
          el.components.light.light.color.set(color);
          el.components.light.light.intensity = intensity;
        }
      },

      applyPalette: function (p) {
        const scene = this.el.sceneEl;
        scene.setAttribute('fog', `type: linear; color: ${p.fog}; near: ${p.fogNear}; far: ${p.fogFar}`);
        this.setLight(this.ctx.ambientLight, 'ambient', p.ambColor, p.ambInt);
        this.setLight(this.ctx.dirLight, 'directional', p.dirColor, p.dirInt);
        this.redrawSky(p.skyTop, p.skyHorizon);
        this.applyVehicleLights(p);
      },

      applyVehicleLights: function (p) {
        this.vehicles.forEach(v => {
          if (!v.lightEls) return;
          v.lightEls[0].setAttribute('material', 'emissiveIntensity', p.headlight);
          v.lightEls[1].setAttribute('material', 'emissiveIntensity', p.taillight);
        });
      },

      // ─── WORLD BUILDING ────────────────────────────────────────────
      createStageWorld: function (parent, startZ, stageLevel, cfg) {
        const lw = this.data.laneWidth;
        const rl = this.data.roadLanes;
        const rivl = this.data.riverLanes;
        const W = 60;

        const surface = (y, z, depth, material) => {
          const p = document.createElement('a-plane');
          p.setAttribute('position', `0 ${y} ${z}`);
          p.setAttribute('rotation', '-90 0 0');
          p.setAttribute('width', W);
          p.setAttribute('height', depth);
          p.setAttribute('material', material);
          parent.appendChild(p);
          return p;
        };

        // Road: one textured plane carries lanes, dashes, wear and edge lines.
        surface(0.01, startZ - 2.5 * lw, 5 * lw, 'src: #roadCanvas; repeat: 2 1; roughness: 1; metalness: 0');

        // Kerbs
        [startZ + 0.09, startZ - 5 * lw - 0.09].forEach(z => {
          const kerb = document.createElement('a-box');
          kerb.setAttribute('width', W); kerb.setAttribute('height', 0.12); kerb.setAttribute('depth', 0.18);
          kerb.setAttribute('color', '#8f8f95');
          kerb.setAttribute('position', `0 0.06 ${z}`);
          kerb.setAttribute('roughness', '1');
          parent.appendChild(kerb);
        });

        // Rush-hour lane telegraph: amber edge strips on the fast lane.
        cfg.road.forEach((laneCfg, i) => {
          if (!laneCfg.isRush) return;
          const laneZ = startZ - (i + 0.5) * lw;
          [laneZ + lw / 2 - 0.15, laneZ - lw / 2 + 0.15].forEach(z => {
            const strip = document.createElement('a-plane');
            strip.setAttribute('position', `0 0.025 ${z}`);
            strip.setAttribute('rotation', '-90 0 0');
            strip.setAttribute('width', W);
            strip.setAttribute('height', 0.14);
            strip.setAttribute('material', 'shader: flat; color: #f59e0b');
            parent.appendChild(strip);
          });
        });

        // Grass strips. The start strip only exists on stage 1 — for every
        // later stage it IS the previous stage's goal strip (z-fight otherwise).
        const grassMat = 'src: #grassCanvas; repeat: 8 1; roughness: 1; metalness: 0';
        if (stageLevel === 1) {
          surface(0.02, startZ + 0.5 * lw, lw, grassMat);
          this.addDecorations(parent, startZ + 0.5 * lw, false);
        }
        const midZ = startZ - (rl + 0.5) * lw;
        surface(0.02, midZ, lw, grassMat);
        this.addDecorations(parent, midZ, false);
        const goalZ = startZ - (rl + 1 + rivl + 0.5) * lw;
        surface(0.02, goalZ, lw, grassMat);
        this.addDecorations(parent, goalZ, true);

        // River: lit base + flat scrolling ripple overlay.
        const riverCenterZ = startZ - (rl + 1) * lw - (rivl * lw) / 2;
        const riverBase = surface(0.008, riverCenterZ, rivl * lw + 0.4, 'color: #2e6da4; roughness: 0.55; metalness: 0');
        riverBase.setAttribute('color', '#2e6da4');
        const ripple = surface(0.03, riverCenterZ, rivl * lw + 0.4,
          'shader: flat; src: #rippleCanvas; transparent: true; opacity: 0.45; repeat: 6 2; depthWrite: false');
        ripple.addEventListener('materialtextureloaded', e => {
          this.rippleTexs.add(e.detail.texture);
          const stageObj = this.stages[stageLevel];
          if (stageObj) stageObj.rippleTex = e.detail.texture;  // pruned in removeStage
        });

        // Lily pads float on the water margin just before the goal bank.
        this.addLilyPads(parent, startZ - 8.92 * lw);

        // Distant scenery: hills + treeline silhouettes, tiled per stage.
        const sceneryZ = startZ - 5 * lw;
        [[-36, 90], [36, -90]].forEach(([x, yaw]) => {
          const tp = document.createElement('a-plane');
          tp.setAttribute('position', `${x} 4 ${sceneryZ}`);
          tp.setAttribute('rotation', `0 ${yaw} 0`);
          tp.setAttribute('width', this.levelDepth());
          tp.setAttribute('height', 8);
          tp.setAttribute('material', 'src: #treelineCanvas; transparent: true; side: double; roughness: 1; metalness: 0');
          parent.appendChild(tp);
        });

        // Boundary hazard walls (stripe texture fading upward). Span exactly
        // one levelDepth so consecutive stages' walls abut instead of
        // overlapping coplanar (which double-composited the stripes).
        const totalDepth = this.levelDepth();
        const wallCenterZ = startZ + lw * 0.5 - totalDepth / 2;
        const ext = this.data.roadExtent;
        [ext, -ext].forEach(xPos => {
          const wall = document.createElement('a-plane');
          wall.setAttribute('position', `${xPos} 2 ${wallCenterZ}`);
          wall.setAttribute('rotation', '0 90 0');
          wall.setAttribute('width', totalDepth);
          wall.setAttribute('height', 4);
          wall.setAttribute('material', 'color: #ffffff; opacity: 0.35; transparent: true; side: double');
          wall.addEventListener('loaded', () => {
            const mesh = wall.getObject3D('mesh');
            if (!mesh) return;
            mesh.material.map = this.hazardTex;
            mesh.material.transparent = true;
            mesh.material.needsUpdate = true;
          });
          parent.appendChild(wall);
        });
      },

      addDecorations: function (parent, z, isGoal) {
        const rnd = Math.random;
        const px = () => (rnd() - 0.5) * 56;
        const pz = () => z + (rnd() - 0.5) * 2.0;
        for (let i = 0; i < 5; i++) {           // bushes
          const r = 0.45 + rnd() * 0.15;
          const b = document.createElement('a-sphere');
          b.setAttribute('radius', r);
          b.setAttribute('scale', '1 0.55 1');
          b.setAttribute('color', i % 2 ? '#2f6b2f' : '#3a7d35');
          b.setAttribute('position', `${px()} ${r * 0.5} ${pz()}`);
          b.setAttribute('roughness', '1');
          parent.appendChild(b);
        }
        for (let i = 0; i < 3; i++) {           // rocks
          const r = 0.25 + rnd() * 0.1;
          const rock = document.createElement('a-dodecahedron');
          rock.setAttribute('radius', r);
          rock.setAttribute('color', '#8f8f94');
          rock.setAttribute('rotation', `0 ${rnd() * 360} 0`);
          rock.setAttribute('position', `${px()} ${r * 0.7} ${pz()}`);
          rock.setAttribute('roughness', '1');
          parent.appendChild(rock);
        }
        const clumps = isGoal ? 4 : 2;
        const petals = ['#ff6b9d', '#ffd23f', '#ffffff'];
        for (let i = 0; i < clumps; i++) {      // flower clumps
          const cx = px(), cz = pz();
          const colour = petals[(rnd() * 3) | 0];
          const base = document.createElement('a-sphere');
          base.setAttribute('radius', 0.28);
          base.setAttribute('scale', '1 0.5 1');
          base.setAttribute('color', '#356f30');
          base.setAttribute('position', `${cx} 0.14 ${cz}`);
          base.setAttribute('roughness', '1');
          parent.appendChild(base);
          for (let f = 0; f < 3; f++) {
            const fl = document.createElement('a-sphere');
            fl.setAttribute('radius', 0.10);
            fl.setAttribute('color', colour);
            fl.setAttribute('position', `${cx + (rnd() - 0.5) * 0.5} 0.32 ${cz + (rnd() - 0.5) * 0.5}`);
            fl.setAttribute('roughness', '1');
            parent.appendChild(fl);
          }
        }
        if (isGoal) {                            // cattails flank the goal bank
          [-14, 14].forEach(x => {
            for (let i = 0; i < 2; i++) {
              const bx = x + (rnd() - 0.5) * 2;
              const stem = document.createElement('a-cylinder');
              stem.setAttribute('radius', 0.03); stem.setAttribute('height', 1.0);
              stem.setAttribute('color', '#4c7a3a');
              stem.setAttribute('position', `${bx} 0.5 ${pz()}`);
              parent.appendChild(stem);
              const head = document.createElement('a-cylinder');
              head.setAttribute('radius', 0.07); head.setAttribute('height', 0.35);
              head.setAttribute('color', '#6b4a2c');
              head.setAttribute('position', `${bx} 1.05 ${pz()}`);
              parent.appendChild(head);
            }
          });
        }
      },

      addLilyPads: function (parent, z) {
        // Small radius + tight jitter keeps pads on the water strip between
        // the last log lane and the goal bank.
        [-12, -6, 0, 6, 12].forEach(x => {
          const pad = document.createElement('a-circle');
          pad.setAttribute('radius', 0.55 + Math.random() * 0.15);
          pad.setAttribute('rotation', `-90 ${Math.random() * 360} 0`);
          pad.setAttribute('position', `${x + (Math.random() - 0.5) * 2} 0.045 ${z + (Math.random() - 0.5) * 0.3}`);
          pad.setAttribute('material', 'src: #lilyCanvas; transparent: true; alphaTest: 0.4; roughness: 1');
          parent.appendChild(pad);
        });
      },

      // ─── PLAYER FROG ───────────────────────────────────────────────
      createPlayerMarker: function () {
        const marker = document.createElement('a-entity');
        marker.setAttribute('id', 'frogPlayer');

        // Constant faint emissive keeps the frog readable at night.
        const glow = 'emissive: #0c2a10; emissiveIntensity: 0.6; roughness: 1';
        const sphere = (r, scale, pos, color, extra) => {
          const s = document.createElement('a-sphere');
          s.setAttribute('radius', r);
          if (scale) s.setAttribute('scale', scale);
          s.setAttribute('position', pos);
          s.setAttribute('color', color);
          s.setAttribute('material', extra || glow);
          marker.appendChild(s);
          return s;
        };

        const body = sphere(0.42, '1 0.75 1.15', '0 0.35 0', '#45b649');
        body.setAttribute('class', 'frog-body');
        body.setAttribute('animation__breathe', {
          property: 'scale', from: '1 0.75 1.15', to: '1.04 0.80 1.15',
          dir: 'alternate', loop: true, dur: 1400, easing: 'easeInOutSine'
        });
        sphere(0.30, '1 0.55 1', '0 0.22 -0.12', '#cde8a0');           // belly
        sphere(0.30, '1 0.7 1', '0 0.55 -0.28', '#45b649');            // head
        sphere(0.13, null, '-0.17 0.78 -0.32', '#f5f9e8', 'roughness: 1');  // eyes
        sphere(0.13, null, '0.17 0.78 -0.32', '#f5f9e8', 'roughness: 1');
        sphere(0.055, null, '-0.17 0.79 -0.43', '#141414', 'roughness: 1'); // pupils
        sphere(0.055, null, '0.17 0.79 -0.43', '#141414', 'roughness: 1');
        sphere(0.18, '1 0.7 1.3', '-0.34 0.22 0.18', '#35984a');       // haunches
        sphere(0.18, '1 0.7 1.3', '0.34 0.22 0.18', '#35984a');
        sphere(0.09, null, '-0.22 0.09 -0.38', '#35984a');             // front feet
        sphere(0.09, null, '0.22 0.09 -0.38', '#35984a');

        const mouth = document.createElement('a-torus');
        mouth.setAttribute('radius', 0.09);
        mouth.setAttribute('radius-tubular', 0.012);
        mouth.setAttribute('arc', 160);
        mouth.setAttribute('rotation', '-75 0 0');
        mouth.setAttribute('position', '0 0.48 -0.545');
        mouth.setAttribute('color', '#2a7d36');
        marker.appendChild(mouth);

        this.root.appendChild(marker);
        this.playerMarker = marker;
      },

      rebuildPlayerMarker: function () {
        if (this.playerMarker && this.playerMarker.parentNode) {
          this.playerMarker.parentNode.removeChild(this.playerMarker);
        }
        this.playerMarker = null;
        this.createPlayerMarker();
      },

      // ─── POSITION HELPERS ──────────────────────────────────────────
      getFrogWorldPos: function () {
        if (this.preStart) {
          return { x: this.spawnX || 0, y: 0.01, z: this.spawnZ || 0 };
        }
        const y = this.onLog ? 0.65 : 0.01;  // platform decks sit at y 0.65
        return { x: this.playerWorldX, y, z: this.laneToZ(this.playerLane) };
      },

      updatePlayerPosition: function (marker) {
        const m = marker || this.playerMarker;
        if (!m) return;
        const pos = this.getFrogWorldPos();
        m.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
        this.moveRigBehindFrog(false);
      },

      moveRigBehindFrog: function (animate) {
        const rig = this.ctx.rig;
        if (!rig) return;
        const pos = this.getFrogWorldPos();
        const targetX = pos.x;
        const targetZ = pos.z + this.rigFollowOffset;
        if (animate) {
          rig.setAttribute('animation__followfrog', {
            property: 'position', to: `${targetX} 0 ${targetZ}`,
            dur: 300, easing: 'easeOutQuad'
          });
        } else {
          rig.object3D.position.set(targetX, 0, targetZ);
        }
      },

      // ─── HOP ───────────────────────────────────────────────────────
      hop: function (dx, dz) {
        if (!this.active || this.dead || this.gameOver || !this.playerMarker) return;
        const now = performance.now();
        if (now - this.lastHopTime < 250) return;
        this.lastHopTime = now;

        if (this.preStart) {
          if (dz >= 0) return;
          if (!this.stages[1]) return;  // stages still building
          this.preStart = false;
          this.playerLane = 0;
          this.playerWorldX = 0;
          this.onLog = false;
          this.currentLogRef = null;
        } else {
          const newLane = this.playerLane + (-dz);
          const newX = this.playerWorldX + dx * 2;
          const maxLane = this.data.roadLanes + this.data.riverLanes + 2;
          if (newLane < 0 || newLane > maxLane) return;
          if (Math.abs(newX) > this.data.roadExtent) {
            // Boundary rejects the hop instead of killing — walls only kill
            // via log drift, where the player had warning.
            this.playerMarker.setAttribute('animation__reject', {
              property: 'scale', from: '0.85 1.1 0.85', to: '1 1 1', dur: 180, easing: 'easeOutQuad'
            });
            return;
          }
          this.playerLane = newLane;
          this.playerWorldX = newX;
        }

        const prevRef = this.currentLogRef;
        this.onLog = false;
        this.currentLogRef = null;
        if (this.isRiverLane(this.playerLane)) {
          const logRef = this.findLogAtPosition(this.playerLane, this.playerWorldX);
          if (logRef) {
            this.onLog = true;
            this.currentLogRef = logRef;
            // Snap the landing onto the deck so edge landings look safe AND are
            // safe — but never snap past the boundary walls, or a successful
            // landing would trigger an instant 'swept' death.
            const centre = logRef.x + (logRef.rideOffset || 0);
            const keep = logRef.length / 2 - 0.3;
            this.playerWorldX = Math.max(centre - keep, Math.min(centre + keep, this.playerWorldX));
            const ext = this.data.roadExtent;
            this.playerWorldX = Math.max(-ext, Math.min(ext, this.playerWorldX));
            logRef.mountT = this.gameNow;  // croc bite timer restarts on every landing
            if (logRef.isCroc) this.resetCrocVisual(logRef);
            AUDIO.sfxLand();
          } else {
            if (prevRef && prevRef.isCroc) this.resetCrocVisual(prevRef);
            // Move the marker to the water it jumped into before the death
            // anim reads its position (else it drowns on the take-off tile).
            this.updatePlayerPosition();
            AUDIO.sfxSplash();
            this.playerHit('drown');
            return;
          }
        }

        // Survived a croc ride and got off — bravery bonus.
        if (prevRef && prevRef.isCroc && prevRef !== this.currentLogRef) {
          this.resetCrocVisual(prevRef);
          this.addScore(25);
          this.showPopup(this.bonusPopup, '+25 CROC!', '#f97316');
          AUDIO.sfxScoreTick();
        }

        AUDIO.sfxHop();
        AUDIO.updateAmbience(this.zoneOf(this.playerLane));

        // Forward progress scores once per lane per attempt.
        if (this.playerLane > this.maxLaneReached) {
          this.maxLaneReached = this.playerLane;
          let pts = 10;
          if (this.isMidSafe(this.playerLane)) pts += 25;
          this.addScore(pts);
          this.showPopup(this.hopPopup, '+' + pts, '#ffffff');
          AUDIO.sfxScoreTick();
        }

        const pos = this.getFrogWorldPos();
        if (this.onLog) {
          // While riding, tick writes marker/rig x directly every frame, which
          // would mask a position tween — snap both instead of animating.
          this.playerMarker.removeAttribute('animation__hop');
          if (this.ctx.rig) this.ctx.rig.removeAttribute('animation__followfrog');
          this.playerMarker.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
          this.moveRigBehindFrog(false);
        } else {
          this.playerMarker.setAttribute('animation__hop', {
            property: 'position', to: `${pos.x} ${pos.y} ${pos.z}`,
            dur: 200, easing: 'easeOutQuad'
          });
          this.moveRigBehindFrog(true);
        }
        // removeAttribute first: identical animation data would deep-equal
        // and A-Frame would skip the restart, so the squash only played once.
        this.playerMarker.removeAttribute('animation__jump');
        this.playerMarker.setAttribute('animation__jump', {
          property: 'scale', from: '1 0.7 1', to: '1 1 1',
          dur: 200, easing: 'easeOutBack'
        });

        if (this.isGoalLane(this.playerLane)) {
          this.winLevel();
        }
      },

      findLogAtPosition: function (lane, worldX) {
        const rIdx = this.riverLaneIndex(lane);
        let best = null, bestDist = Infinity;
        for (const log of this.logs) {
          if (log.stageLevel !== this.level) continue;
          if (log.laneIdx !== rIdx) continue;
          const centre = log.x + (log.rideOffset || 0);
          const d = Math.abs(worldX - centre);
          // 0.4 landing tolerance: edge landings that look safe in VR are safe.
          if (d <= log.length / 2 + 0.4 && d < bestDist) { best = log; bestDist = d; }
        }
        return best;
      },

      // ─── SPAWNING (distance-scheduled, no timers) ──────────────────
      // Every entity's front bumper enters at the same spawn line, so the
      // advance needed to open `gapDist` of clear road behind an entity of
      // half-width h is exactly 2h + gapDist.
      pickNext: function (st) {
        st.count++;
        if (st.isRiver) {
          // Never two crocs in a row: a plain log at least every other platform.
          const croc = !st.prevWasCroc && this.hash01(st.lvl, st.laneIdx, 300 + st.count) < st.cfg.crocShare;
          st.prevWasCroc = croc;
          return croc ? { croc: true, halfW: 3.2 } : { croc: false, halfW: st.cfg.logLen / 2 };
        }
        const truck = this.hash01(st.lvl, st.laneIdx, 200 + st.count) < st.cfg.truckShare;
        return { truck, halfW: truck ? 4 : 2 };
      },

      prepopLane: function (stage, st) {
        st.count = 0;
        st.prevWasCroc = false;
        st.next = this.pickNext(st);
        st.need = st.cfg.gapDist;  // first spawn fires almost immediately
        // Pretend the lane has been flowing for a full crossing plus a seeded
        // phase, then drain it — one code path for prepop and runtime.
        st.travel = 2 * (this.data.roadExtent + 6) + st.cfg.phase * (2 * st.next.halfW + st.cfg.gapDist);
        this.tickLaneSpawner(st, 0);
      },

      tickLaneSpawner: function (st, dtSec) {
        if (!st.next) return;  // lane not pre-populated yet (queued)
        st.travel += st.cfg.speed * dtSec;
        const edge = this.data.roadExtent + 6;  // spawn 6 m beyond the walls: no spawn-kills
        while (st.travel >= st.need) {
          st.travel -= st.need;
          const x = -st.cfg.dir * (edge + st.next.halfW) + st.cfg.dir * st.travel;
          if (Math.abs(x) <= this.data.roadExtent + 12) {
            this.spawnEntity(st, x, st.next);
          }
          // A croc's reserved footprint includes its unrideable tail; pull the
          // follower 1.4 closer so the RIDEABLE gap matches the log gap and the
          // ≤2.5 s platform-wait guarantee holds for croc lanes too.
          st.need = 2 * st.next.halfW + st.cfg.gapDist - (st.next.croc ? 1.4 : 0);
          st.next = this.pickNext(st);
        }
      },

      spawnEntity: function (st, x, pick) {
        if (!this.stages[st.stageLevel]) return;
        if (st.isRiver) {
          if (pick.croc) this.spawnCrocAt(st, x);
          else this.spawnLogAt(st, x);
        } else {
          this.spawnVehicleAt(st, x, pick.truck);
        }
      },

      spawnVehicleAt: function (st, xPos, isTruck) {
        const stage = this.stages[st.stageLevel];
        if (!stage || !stage.el) return;
        const vehicle = document.createElement('a-entity');
        vehicle.setAttribute('class', 'frogger-vehicle');
        const lightEls = isTruck ? this.buildTruck(vehicle, st.cfg.color)
                                 : this.buildCar(vehicle, st.cfg.color);
        // Models are authored facing −X; yaw so headlights face travel direction.
        vehicle.setAttribute('rotation', `0 ${st.cfg.dir > 0 ? 180 : 0} 0`);
        vehicle.setAttribute('position', `${xPos} 0.01 ${st.laneZ}`);
        stage.el.appendChild(vehicle);
        const p = PALETTES[this.band];
        lightEls[0].setAttribute('material', 'emissiveIntensity', p.headlight);
        lightEls[1].setAttribute('material', 'emissiveIntensity', p.taillight);
        this.vehicles.push({
          el: vehicle, x: xPos, z: st.laneZ, dir: st.cfg.dir,
          speed: st.cfg.speed, lane: st.laneIdx, width: isTruck ? 8 : 4,
          stageLevel: st.stageLevel, lightEls,
          justSpawned: true  // spawn position already includes this frame's travel
        });
      },

      spawnLogAt: function (st, xPos) {
        const stage = this.stages[st.stageLevel];
        if (!stage || !stage.el) return;
        const logLen = st.cfg.logLen;
        const logEl = document.createElement('a-entity');
        this.buildLogModel(logEl, logLen);
        logEl.setAttribute('position', `${xPos} 0.01 ${st.laneZ}`);
        stage.el.appendChild(logEl);
        this.logs.push({
          el: logEl, x: xPos, z: st.laneZ, dir: st.cfg.dir,
          speed: st.cfg.speed, laneIdx: st.laneIdx, length: logLen,
          stageLevel: st.stageLevel, isCroc: false, rideOffset: 0,
          justSpawned: true
        });
      },

      spawnCrocAt: function (st, xPos) {
        const stage = this.stages[st.stageLevel];
        if (!stage || !stage.el) return;
        const crocEl = document.createElement('a-entity');
        const parts = this.buildCrocModel(crocEl);
        crocEl.setAttribute('rotation', `0 ${st.cfg.dir > 0 ? 180 : 0} 0`);
        crocEl.setAttribute('position', `${xPos} 0.01 ${st.laneZ}`);
        stage.el.appendChild(crocEl);
        this.logs.push({
          el: crocEl, x: xPos, z: st.laneZ, dir: st.cfg.dir,
          speed: st.cfg.speed, laneIdx: st.laneIdx,
          // Rideable deck = head + body, which sits off-centre toward the head.
          length: 4.45,
          rideOffset: st.cfg.dir > 0 ? 0.625 : -0.625,
          stageLevel: st.stageLevel, isCroc: true,
          graceMs: st.cfg.graceMs, warnMs: st.cfg.warnMs,
          mountT: 0, warned: false,
          jawEl: parts.jawEl, eyeEls: parts.eyeEls,
          justSpawned: true
        });
      },

      // ─── MODEL BUILDERS ────────────────────────────────────────────
      buildCar: function (entity, color) {
        // 3 body styles; front = −X. Returns [headlightBar, taillightBar].
        const styles = [
          { body: [3.4, 0.7, 1.7, 0, 0.55, 0], cabin: [1.8, 0.6, 1.5, 0.1, 1.15, 0], ax: 1.15, lx: 1.72, ly: 0.55 },
          { body: [2.9, 0.75, 1.7, 0, 0.58, 0], cabin: [1.6, 0.68, 1.55, 0.35, 1.2, 0], ax: 1.0, lx: 1.47, ly: 0.58 },
          { body: [3.6, 0.65, 1.75, 0, 0.55, 0], cabin: [1.4, 0.75, 1.6, -0.7, 1.2, 0], ax: 1.25, lx: 1.82, ly: 0.55 }
        ];
        const s = styles[Math.floor(Math.random() * 3)];

        const box = (dims, colour, material) => {
          const b = document.createElement('a-box');
          b.setAttribute('width', dims[0]); b.setAttribute('height', dims[1]); b.setAttribute('depth', dims[2]);
          b.setAttribute('position', `${dims[3]} ${dims[4]} ${dims[5]}`);
          if (colour) b.setAttribute('color', colour);
          if (material) b.setAttribute('material', material);
          else b.setAttribute('roughness', '1');
          entity.appendChild(b);
          return b;
        };

        box(s.body, color);
        box(s.cabin, null, 'src: #glassCanvas; roughness: 0.6; metalness: 0');
        // One full-width cylinder per axle (not 4 wheels): same silhouette
        // from the player's mostly-edge-on view, half the meshes on Quest.
        [-s.ax, s.ax].forEach(wx => {
          const w = document.createElement('a-cylinder');
          w.setAttribute('radius', 0.35); w.setAttribute('height', 1.96);
          w.setAttribute('rotation', '90 0 0');
          w.setAttribute('color', '#1b1b1f');
          w.setAttribute('roughness', '1');
          w.setAttribute('position', `${wx} 0.35 0`);
          entity.appendChild(w);
        });
        const head = box([0.06, 0.16, 1.3, -s.lx, s.ly, 0], '#fff7cc', 'color: #fff7cc; emissive: #fff3b0; emissiveIntensity: 0.15');
        const tail = box([0.06, 0.14, 1.3, s.lx, s.ly, 0], '#7a0f14', 'color: #7a0f14; emissive: #ff2222; emissiveIntensity: 0.3');
        return [head, tail];
      },

      buildTruck: function (entity, color) {
        // Authored centred so the visual span matches the width-8 hitbox.
        const box = (w, h, d, x, y, z, colour, material) => {
          const b = document.createElement('a-box');
          b.setAttribute('width', w); b.setAttribute('height', h); b.setAttribute('depth', d);
          b.setAttribute('position', `${x} ${y} ${z}`);
          if (colour) b.setAttribute('color', colour);
          if (material) b.setAttribute('material', material);
          else b.setAttribute('roughness', '1');
          entity.appendChild(b);
          return b;
        };
        box(2.2, 2.0, 2.2, -2.9, 1.15, 0, color);
        const stack = document.createElement('a-cylinder');
        stack.setAttribute('radius', 0.08); stack.setAttribute('height', 0.9);
        stack.setAttribute('color', '#44464a');
        stack.setAttribute('position', '-1.95 1.9 0.9');
        entity.appendChild(stack);
        box(5.6, 2.4, 2.4, 1.2, 1.45, 0, '#e6e4de');
        box(5.6, 0.4, 2.45, 1.2, 0.55, 0, color);
        [-3.1, 0.1, 2.5].forEach(wx => {
          const w = document.createElement('a-cylinder');
          w.setAttribute('radius', 0.42); w.setAttribute('height', 2.5);
          w.setAttribute('rotation', '90 0 0');
          w.setAttribute('color', '#1b1b1f');
          w.setAttribute('roughness', '1');
          w.setAttribute('position', `${wx} 0.42 0`);
          entity.appendChild(w);
        });
        const head = box(0.06, 0.2, 1.6, -4.02, 0.85, 0, '#fff7cc', 'color: #fff7cc; emissive: #fff3b0; emissiveIntensity: 0.15');
        const tail = box(0.06, 0.18, 2.0, 4.02, 0.7, 0, '#7a0f14', 'color: #7a0f14; emissive: #ff2222; emissiveIntensity: 0.3');
        return [head, tail];
      },

      buildLogModel: function (logEl, logLen) {
        // tick writes logEl position.x, so the bob lives on a child.
        const bobber = document.createElement('a-entity');
        bobber.setAttribute('animation__bob', {
          property: 'position', from: '0 -0.035 0', to: '0 0.035 0',
          dir: 'alternate', loop: true, dur: 1600 + Math.random() * 800, easing: 'easeInOutSine'
        });
        logEl.appendChild(bobber);

        const trunk = document.createElement('a-cylinder');
        trunk.setAttribute('radius', 0.45);
        trunk.setAttribute('height', logLen);
        trunk.setAttribute('rotation', '0 0 90');  // axis → X
        trunk.setAttribute('position', '0 0.2 0'); // top at 0.65, hull 25 cm in the water
        trunk.setAttribute('material', `src: #barkCanvas; roughness: 1; repeat: 1 ${Math.max(1, Math.round(logLen / 3))}`);
        bobber.appendChild(trunk);

        [[-logLen / 2, -90], [logLen / 2, 90]].forEach(([x, yaw]) => {
          const cap = document.createElement('a-circle');
          cap.setAttribute('radius', 0.45);
          cap.setAttribute('rotation', `0 ${yaw} 0`);
          cap.setAttribute('position', `${x} 0.2 0`);
          cap.setAttribute('material', 'src: #logEndCanvas; roughness: 1');
          bobber.appendChild(cap);
        });
      },

      buildCrocModel: function (crocEl) {
        // Head toward −X; deck (head + body) top at y 0.65 like the logs.
        const bobber = document.createElement('a-entity');
        bobber.setAttribute('animation__bob', {
          property: 'position', from: '0 -0.03 0', to: '0 0.03 0',
          dir: 'alternate', loop: true, dur: 1800 + Math.random() * 600, easing: 'easeInOutSine'
        });
        crocEl.appendChild(bobber);

        const body = document.createElement('a-box');
        body.setAttribute('width', 3.2); body.setAttribute('height', 0.5); body.setAttribute('depth', 1.4);
        body.setAttribute('position', '0 0.4 0');
        body.setAttribute('material', 'src: #crocHideCanvas; roughness: 1');
        bobber.appendChild(body);

        const tailPivot = document.createElement('a-entity');
        tailPivot.setAttribute('position', '1.6 0.35 0');
        tailPivot.setAttribute('animation__sway', {
          property: 'rotation', from: '0 -6 0', to: '0 6 0',
          dir: 'alternate', loop: true, dur: 900, easing: 'easeInOutSine'
        });
        const tail = document.createElement('a-cone');
        tail.setAttribute('radius-bottom', 0.5); tail.setAttribute('radius-top', 0.08);
        tail.setAttribute('height', 1.8);
        tail.setAttribute('rotation', '0 0 -90');  // tip points +X, away from the head
        tail.setAttribute('position', '0.9 0 0');
        tail.setAttribute('color', '#37602f');
        tail.setAttribute('roughness', '1');
        tailPivot.appendChild(tail);
        bobber.appendChild(tailPivot);

        const lowerHead = document.createElement('a-box');
        lowerHead.setAttribute('width', 1.3); lowerHead.setAttribute('height', 0.35); lowerHead.setAttribute('depth', 0.9);
        lowerHead.setAttribute('position', '-2.2 0.3 0');
        lowerHead.setAttribute('color', '#3e6b35');
        lowerHead.setAttribute('roughness', '1');
        bobber.appendChild(lowerHead);

        const mouthFloor = document.createElement('a-plane');
        mouthFloor.setAttribute('width', 1.1); mouthFloor.setAttribute('height', 0.7);
        mouthFloor.setAttribute('rotation', '-90 0 0');
        mouthFloor.setAttribute('position', '-2.25 0.48 0');
        mouthFloor.setAttribute('color', '#a83232');  // visible only when the jaw opens
        bobber.appendChild(mouthFloor);

        const jawEl = document.createElement('a-entity');
        jawEl.setAttribute('position', '-1.55 0.52 0');
        const upperJaw = document.createElement('a-box');
        upperJaw.setAttribute('width', 1.3); upperJaw.setAttribute('height', 0.18); upperJaw.setAttribute('depth', 0.85);
        upperJaw.setAttribute('position', '-0.65 0.09 0');
        upperJaw.setAttribute('material', 'src: #crocHideCanvas; roughness: 1');
        jawEl.appendChild(upperJaw);
        bobber.appendChild(jawEl);

        const eyeEls = [];
        [0.32, -0.32].forEach(z => {
          const eye = document.createElement('a-sphere');
          eye.setAttribute('radius', 0.09);
          eye.setAttribute('position', `-1.5 0.68 ${z}`);
          eye.setAttribute('color', '#d8c94a');
          eye.setAttribute('material', 'emissive: #ff2200; emissiveIntensity: 0');
          bobber.appendChild(eye);
          eyeEls.push(eye);
        });

        return { jawEl, eyeEls };
      },

      resetCrocVisual: function (log) {
        log.warned = false;
        if (log.jawEl) {
          log.jawEl.setAttribute('animation__jaw', {
            property: 'rotation', to: '0 0 0', dur: 200, easing: 'easeInQuad'
          });
        }
        if (log.eyeEls) log.eyeEls.forEach(e => e.setAttribute('material', 'emissiveIntensity', 0));
        if (this.jumpWarn) this.jumpWarn.setAttribute('visible', 'false');
      },

      // ─── HUD / POPUPS / CONFETTI ───────────────────────────────────
      buildHud: function () {
        const cam = this.ctx.camera;
        const hud = document.createElement('a-entity');
        hud.setAttribute('position', '0 -0.42 -1.1');
        hud.setAttribute('rotation', '-18 0 0');
        hud.setAttribute('visible', 'false');

        const mkText = (v, x, y, align, color, width) => {
          const t = document.createElement('a-text');
          t.setAttribute('value', v);
          t.setAttribute('position', `${x} ${y} 0`);
          t.setAttribute('align', align);
          t.setAttribute('color', color);
          t.setAttribute('width', width);
          hud.appendChild(t);
          return t;
        };
        this.scoreText = mkText('SCORE 0', -0.55, 0, 'left', '#ffffff', 0.9);
        this.levelText = mkText('LEVEL 1', 0.0, 0, 'center', '#fbbf24', 0.9);

        // Lives as mini frog icons (♥ is missing from the MSDF font).
        this.lifeIcons = [];
        for (let i = 0; i < 3; i++) {
          const f = document.createElement('a-entity');
          f.setAttribute('position', `${0.38 + i * 0.09} 0.005 0`);
          const b = document.createElement('a-box');
          b.setAttribute('width', 0.055); b.setAttribute('height', 0.04); b.setAttribute('depth', 0.03);
          b.setAttribute('color', '#22c55e');
          f.appendChild(b);
          [-0.015, 0.015].forEach(ex => {
            const e = document.createElement('a-box');
            e.setAttribute('width', 0.014); e.setAttribute('height', 0.014); e.setAttribute('depth', 0.008);
            e.setAttribute('color', '#ffffff');
            e.setAttribute('position', `${ex} 0.024 0.014`);
            f.appendChild(e);
          });
          hud.appendChild(f);
          this.lifeIcons.push(f);
        }

        this.msgText = mkText('', 0, 0.30, 'center', '#ffffff', 1.6);
        this.jumpWarn = mkText('JUMP!', 0, 0.48, 'center', '#ff3b30', 2.0);
        this.jumpWarn.setAttribute('visible', 'false');
        this.jumpWarn.setAttribute('animation__blink', {
          property: 'opacity', from: 1, to: 0.1, dur: 150, dir: 'alternate', loop: true
        });

        cam.appendChild(hud);
        this.hudRoot = hud;

        // Game-over panel
        const go = document.createElement('a-entity');
        go.setAttribute('position', '0 0 -1.4');
        go.setAttribute('visible', 'false');
        const bg = document.createElement('a-plane');
        bg.setAttribute('width', 1.6); bg.setAttribute('height', 1.0);
        bg.setAttribute('material', 'color: #0f172a; opacity: 0.92; transparent: true; shader: flat; depthWrite: false');
        go.appendChild(bg);
        const goText = (v, y, w, color) => {
          const t = document.createElement('a-text');
          t.setAttribute('value', v);
          t.setAttribute('position', `0 ${y} 0.01`);
          t.setAttribute('align', 'center');
          t.setAttribute('color', color);
          t.setAttribute('width', w);
          go.appendChild(t);
          return t;
        };
        goText('GAME OVER', 0.30, 2.2, '#ef4444');
        this.goScore = goText('', 0.05, 1.6, '#ffffff');
        this.goBest = goText('', -0.13, 1.6, '#fbbf24');
        this.goLevel = goText('', -0.30, 1.2, '#94a3b8');
        cam.appendChild(go);
        this.gameOverRoot = go;

        // (The death/respawn/exit veil is the host's ctx.fadeTo — no local plane.)

        // Pooled score popups (no per-hop allocation).
        const mkPopup = (width, color) => {
          const t = document.createElement('a-text');
          t.setAttribute('value', '');
          t.setAttribute('align', 'center');
          t.setAttribute('color', color);
          t.setAttribute('width', width);
          t.setAttribute('visible', 'false');
          this.root.appendChild(t);
          return t;
        };
        this.hopPopup = mkPopup(5, '#ffffff');
        this.bonusPopup = mkPopup(8, '#fbbf24');

        // Pooled confetti burst for level wins.
        const confetti = document.createElement('a-entity');
        confetti.setAttribute('visible', 'false');
        const confColors = ['#fbbf24', '#22c55e', '#e63946', '#457b9d'];
        for (let i = 0; i < 12; i++) {
          const b = document.createElement('a-box');
          b.setAttribute('width', 0.12); b.setAttribute('height', 0.12); b.setAttribute('depth', 0.12);
          b.setAttribute('color', confColors[i % 4]);
          confetti.appendChild(b);
        }
        this.root.appendChild(confetti);
        this.confettiRoot = confetti;
      },

      updateHud: function () {
        if (!this.hudRoot) return;
        this.scoreText.setAttribute('value', 'SCORE ' + this.score);
        this.levelText.setAttribute('value', 'LEVEL ' + this.level);
        this.lifeIcons.forEach((f, i) => f.setAttribute('visible', i < this.lives));
      },

      addScore: function (pts) {
        this.score += pts;
        if (this.score > this.highScore) this.highScore = this.score;
        this.updateHud();
      },

      persistBest: function () {
        try {
          localStorage.setItem('froggerHighScore', String(this.highScore));
          const bl = parseInt(localStorage.getItem('froggerBestLevel') || '1', 10);
          if (this.level > bl) localStorage.setItem('froggerBestLevel', String(this.level));
        } catch (e) { /* localStorage can throw in some WebXR contexts */ }
      },

      showPopup: function (el, text, color) {
        if (!el) return;
        const pos = this.getFrogWorldPos();
        el.setAttribute('value', text);
        el.setAttribute('color', color);
        el.setAttribute('position', `${pos.x} ${pos.y + 1.3} ${pos.z}`);
        el.setAttribute('visible', 'true');
        el.removeAttribute('animation__rise');
        el.removeAttribute('animation__fade');
        el.setAttribute('animation__rise', {
          property: 'position', to: `${pos.x} ${pos.y + 2.5} ${pos.z}`, dur: 900, easing: 'easeOutQuad'
        });
        el.setAttribute('animation__fade', {
          property: 'opacity', from: 1, to: 0, delay: 300, dur: 600, easing: 'easeInQuad'
        });
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(() => el.setAttribute('visible', 'false'), 950);
      },

      burstConfetti: function () {
        if (!this.confettiRoot) return;
        const pos = this.getFrogWorldPos();
        this.confettiRoot.object3D.position.set(pos.x, 0.5, pos.z);
        this.confettiRoot.setAttribute('visible', 'true');
        this.confettiRoot.querySelectorAll('a-box').forEach(b => {
          const dx = (Math.random() - 0.5) * 4, dy = 1.5 + Math.random() * 2, dz = (Math.random() - 0.5) * 4;
          b.setAttribute('position', '0 0 0');
          b.removeAttribute('animation__fly');
          b.setAttribute('animation__fly', {
            property: 'position', to: `${dx} ${dy} ${dz}`, dur: 700, easing: 'easeOutQuad'
          });
        });
        setTimeout(() => { if (this.confettiRoot) this.confettiRoot.setAttribute('visible', 'false'); }, 750);
      },

      fadeTo: function (opacity, dur) {
        if (this.ctx && this.ctx.fadeTo) this.ctx.fadeTo(opacity, dur);
      },

      // ─── LEVEL LABEL ───────────────────────────────────────────────
      showLevelLabel: function () {
        if (this.levelLabel && this.levelLabel.parentNode) {
          this.levelLabel.parentNode.removeChild(this.levelLabel);
        }
        const pos = this.getFrogWorldPos();
        const root = document.createElement('a-entity');
        root.setAttribute('position', `${pos.x} 4 ${pos.z - 3}`);
        const label = document.createElement('a-text');
        label.setAttribute('value', `LEVEL ${this.level}`);
        label.setAttribute('color', '#fbbf24');
        label.setAttribute('align', 'center');
        label.setAttribute('width', 8);
        root.appendChild(label);
        const sub = document.createElement('a-text');
        sub.setAttribute('value', `+${100 * this.level} to cross`);
        sub.setAttribute('color', '#94a3b8');
        sub.setAttribute('align', 'center');
        sub.setAttribute('width', 5);
        sub.setAttribute('position', '0 -0.7 0');
        root.appendChild(sub);
        root.setAttribute('animation__drop', {
          property: 'position', to: `${pos.x} 2.5 ${pos.z - 3}`, dur: 400, easing: 'easeOutQuad'
        });
        this.root.appendChild(root);
        this.levelLabel = root;
        setTimeout(() => {
          if (this.levelLabel === root) {
            [label, sub].forEach(t => t.setAttribute('animation__fade', {
              property: 'opacity', to: 0, dur: 1500, easing: 'easeInQuad'
            }));
            setTimeout(() => {
              if (this.levelLabel === root && root.parentNode) {
                root.parentNode.removeChild(root);
                this.levelLabel = null;
              }
            }, 1600);
          }
        }, 2000);
      },

      // ─── TICK ──────────────────────────────────────────────────────
      tick: function (time, timeDelta) {
        if (!this.active || this.dead || this.gameOver) return;
        // Clamp the frame delta: doffing a Quest headset (or a hidden tab)
        // pauses RAF, and the resume frame would otherwise advance the world
        // by minutes — culling every vehicle and platform at once.
        timeDelta = Math.min(timeDelta, 100);
        const seconds = timeDelta / 1000;
        this.gameNow += timeDelta;
        const now = performance.now();

        // VR stick: edge-triggered latch — one flick = one hop (hysteresis
        // 0.5 trigger / 0.3 release; hold never auto-repeats).
        const mag = Math.max(Math.abs(this.leftStick.x), Math.abs(this.leftStick.y));
        if (this.stickArmed && mag > 0.5) {
          const lx = this.leftStick.x, ly = this.leftStick.y;
          if (Math.abs(ly) >= Math.abs(lx)) this.hop(0, ly > 0 ? 1 : -1);
          else this.hop(lx > 0 ? 1 : -1, 0);
          this.stickArmed = false;
        } else if (mag < 0.3) {
          this.stickArmed = true;
        }

        // Day/dusk/night palette transition (smoothstep over 2.5 s).
        if (this.palT !== undefined && this.palT < 1) {
          this.palT = Math.min(1, this.palT + timeDelta / 2500);
          const t = this.palT * this.palT * (3 - 2 * this.palT);
          const lerpC = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), t);
          const A = this.palFrom, B = this.palTo, scene = this.el.sceneEl;
          if (scene.object3D.fog) {
            scene.object3D.fog.color.copy(lerpC(A.fog, B.fog));
            scene.object3D.fog.near = A.fogNear + (B.fogNear - A.fogNear) * t;
            scene.object3D.fog.far = A.fogFar + (B.fogFar - A.fogFar) * t;
          }
          const ambEl = this.ctx.ambientLight;
          const dirEl = this.ctx.dirLight;
          if (ambEl && ambEl.components.light) {
            const amb = ambEl.components.light.light;
            amb.color.copy(lerpC(A.ambColor, B.ambColor));
            amb.intensity = A.ambInt + (B.ambInt - A.ambInt) * t;
          }
          if (dirEl && dirEl.components.light) {
            const dir = dirEl.components.light.light;
            dir.color.copy(lerpC(A.dirColor, B.dirColor));
            dir.intensity = A.dirInt + (B.dirInt - A.dirInt) * t;
          }
          this.redrawSky(lerpC(A.skyTop, B.skyTop).getStyle(), lerpC(A.skyHorizon, B.skyHorizon).getStyle());
          // On completion, re-apply via attributes so component data matches
          // the directly-mutated THREE state (else later setAttribute diffs skip).
          if (this.palT === 1) this.applyPalette(B);
        }

        // Water drift.
        this.rippleTexs.forEach(tx => { tx.offset.x = (tx.offset.x + 0.035 * seconds) % 1; });

        // Drain one queued lane pre-population per frame (spreads the ~60
        // entity creations of a new stage across frames instead of stalling).
        if (this.prepopQueue.length) {
          const job = this.prepopQueue.shift();
          if (this.stages[job.st.stageLevel]) this.prepopLane(job.stage, job.st);
        }

        // Distance-scheduled spawners for every live stage.
        Object.keys(this.stages).forEach(k => {
          this.stages[k].laneStates.forEach(st => this.tickLaneSpawner(st, seconds));
        });

        const extent = this.data.roadExtent;
        const cull = extent + 12;

        // Vehicles. justSpawned entities skip their first move — their spawn
        // position already carries this frame's travel.
        for (let i = this.vehicles.length - 1; i >= 0; i--) {
          const v = this.vehicles[i];
          if (v.justSpawned) v.justSpawned = false;
          else v.x += v.dir * v.speed * seconds;
          v.el.object3D.position.x = v.x;
          if (Math.abs(v.x) > cull) {
            if (v.el.parentNode) v.el.parentNode.removeChild(v.el);
            this.vehicles.splice(i, 1);
            continue;
          }
          // Collision vs the current stage's lane only; the 120 ms grace
          // stops deaths that would visually land mid-hop-animation.
          if (v.stageLevel === this.level && this.isRoadLane(this.playerLane) &&
              v.lane === this.playerLane - 1 && now - this.lastHopTime > 120) {
            if (Math.abs(v.x - this.playerWorldX) < v.width / 2 + 0.4) {
              AUDIO.sfxVehicleHit();
              this.playerHit('vehicle');
            }
          }
        }

        // Logs and crocs.
        for (let i = this.logs.length - 1; i >= 0; i--) {
          const log = this.logs[i];
          if (log.justSpawned) log.justSpawned = false;
          else log.x += log.dir * log.speed * seconds;
          log.el.object3D.position.x = log.x;
          if (Math.abs(log.x) > cull) {
            if (log.el.parentNode) log.el.parentNode.removeChild(log.el);
            this.logs.splice(i, 1);
            if (this.currentLogRef === log) {
              this.currentLogRef = null;
              this.onLog = false;
              AUDIO.sfxSplash();
              this.playerHit('drown');
            }
            continue;
          }
        }

        // Frog rides its platform.
        if (this.onLog && this.currentLogRef) {
          const log = this.currentLogRef;
          this.playerWorldX += log.dir * log.speed * seconds;
          const centre = log.x + (log.rideOffset || 0);
          if (Math.abs(this.playerWorldX - centre) > log.length / 2 + 0.3) {
            this.onLog = false;
            this.currentLogRef = null;
            if (log.isCroc) this.resetCrocVisual(log);
            AUDIO.sfxSplash();
            this.playerHit('drown');
            return;
          }
          if (Math.abs(this.playerWorldX) > extent) {
            this.onLog = false;
            this.currentLogRef = null;
            if (log.isCroc) this.resetCrocVisual(log);
            AUDIO.sfxSplash();
            this.playerHit('swept');
            return;
          }

          // Croc bite timer: grace → 1.5 s warning (jaw opens, eyes glow,
          // JUMP! blinks, growl) → snap kills whoever is still aboard.
          if (log.isCroc) {
            const ride = this.gameNow - log.mountT;
            if (ride > log.graceMs + log.warnMs) {
              log.jawEl.setAttribute('animation__jaw', {
                property: 'rotation', to: '0 0 0', dur: 120, easing: 'easeInQuad'
              });
              if (this.jumpWarn) this.jumpWarn.setAttribute('visible', 'false');
              AUDIO.sfxCrocSnap();
              this.playerHit('croc');
              return;
            }
            if (ride > log.graceMs && !log.warned) {
              log.warned = true;
              log.jawEl.setAttribute('animation__jaw', {
                property: 'rotation', to: '0 0 -38', dur: 800, easing: 'easeOutQuad'
              });
              log.eyeEls.forEach(e => e.setAttribute('material', 'emissiveIntensity', 1.8));
              if (this.jumpWarn) this.jumpWarn.setAttribute('visible', 'true');
              AUDIO.sfxCrocWarn();
              setTimeout(() => {
                if (log.warned && this.currentLogRef === log && !this.dead) AUDIO.sfxCrocWarn();
              }, 750);
            }
          }

          if (this.playerMarker) {
            const pos = this.getFrogWorldPos();
            this.playerMarker.object3D.position.x = pos.x;
            this.playerMarker.object3D.position.y = pos.y;
          }
          if (this.ctx.rig) this.ctx.rig.object3D.position.x = this.playerWorldX;
        }
      },

      // ─── DEATH / LIVES / GAME OVER ─────────────────────────────────
      playerHit: function (cause) {
        if (this.dead || this.gameOver) return;
        this.dead = true;
        if (this.currentLogRef && this.currentLogRef.isCroc) this.resetCrocVisual(this.currentLogRef);
        this.onLog = false;
        this.currentLogRef = null;
        this.lives--;
        this.updateHud();
        this.persistBest();
        AUDIO.duckMusic();
        this.playDeathAnim(cause || 'vehicle');
        this.showDeathMessage(cause || 'vehicle');
        if (this.lives > 0) {
          this.setT(() => this.fadeTo(1, 350), 1100);
          this.setT(() => { this.respawn(); this.fadeTo(0, 400); }, 1500);
        } else {
          this.setT(() => this.doGameOver(), 1500);
        }
      },

      playDeathAnim: function (cause) {
        const m = this.playerMarker;
        if (!m) return;
        const mp = m.object3D.position;
        if (cause === 'drown' || cause === 'swept') {
          m.object3D.traverse(o => { if (o.material && o.material.color) o.material.color.set('#38bdf8'); });
          m.setAttribute('animation__die', {
            property: 'position', to: `${mp.x} -0.9 ${mp.z}`, dur: 700, easing: 'easeInQuad'
          });
          m.setAttribute('animation__dietilt', {
            property: 'rotation', to: '20 0 15', dur: 700, easing: 'easeInQuad'
          });
          // Expanding ripple rings where the frog went under.
          [0, 250].forEach(delay => {
            setTimeout(() => {
              const ring = document.createElement('a-ring');
              ring.setAttribute('radius-inner', 0.15);
              ring.setAttribute('radius-outer', 0.2);
              ring.setAttribute('color', '#cfe8ff');
              ring.setAttribute('rotation', '-90 0 0');
              ring.setAttribute('position', `${mp.x} 0.05 ${mp.z}`);
              ring.setAttribute('material', 'shader: flat; transparent: true; opacity: 0.8');
              ring.setAttribute('animation__grow', { property: 'scale', to: '4 4 4', dur: 900, easing: 'easeOutQuad' });
              ring.setAttribute('animation__fade', { property: 'material.opacity', to: 0, dur: 900, easing: 'easeOutQuad' });
              this.root.appendChild(ring);
              setTimeout(() => { if (ring.parentNode) ring.parentNode.removeChild(ring); }, 950);
            }, delay);
          });
        } else if (cause === 'croc') {
          m.setAttribute('animation__die', {
            property: 'scale', to: '0.05 0.05 0.05', dur: 150, easing: 'easeInQuad'
          });
        } else {  // vehicle
          m.object3D.traverse(o => { if (o.material && o.material.color) o.material.color.set('#b23b3b'); });
          m.setAttribute('animation__die', {
            property: 'scale', to: '1.5 0.1 1.5', dur: 400, easing: 'easeInQuad'
          });
          const splat = document.createElement('a-circle');
          splat.setAttribute('radius', 0.7);
          splat.setAttribute('color', '#7f1d1d');
          splat.setAttribute('rotation', '-90 0 0');
          splat.setAttribute('position', `${mp.x} 0.04 ${mp.z}`);
          splat.setAttribute('material', 'shader: flat; transparent: true; opacity: 0.9');
          splat.setAttribute('animation__fade', { property: 'material.opacity', to: 0, dur: 1200, easing: 'easeInQuad' });
          this.root.appendChild(splat);
          setTimeout(() => { if (splat.parentNode) splat.parentNode.removeChild(splat); }, 1250);
        }
      },

      showDeathMessage: function (cause) {
        if (!this.msgText) return;
        const msgs = {
          vehicle: ['SPLAT!', '#ef4444'],
          drown: ['GLUB GLUB...', '#38bdf8'],
          croc: ['CHOMP!', '#f97316'],
          swept: ['SWEPT AWAY!', '#38bdf8']
        };
        const [txt, col] = msgs[cause] || msgs.vehicle;
        this.msgText.setAttribute('value', txt);
        this.msgText.setAttribute('color', col);
        setTimeout(() => this.msgText.setAttribute('value', ''), 1400);
      },

      respawn: function () {
        // Keep: level, levelStartZ, stages (traffic keeps flowing), score.
        this.dead = false;
        this.playerLane = 0;
        this.playerWorldX = 0;
        this.onLog = false;
        this.currentLogRef = null;
        this.maxLaneReached = 0;
        this.levelStartTime = performance.now();
        this.rebuildPlayerMarker();
        this.updatePlayerPosition();  // snaps rig behind the frog, behind the fade
        AUDIO.restoreMusic();
        AUDIO.updateAmbience('safe');
      },

      doGameOver: function () {
        this.gameOver = true;
        this.persistBest();
        const newBest = this.score >= this.highScore && this.score > 0;
        this.goScore.setAttribute('value', 'SCORE  ' + this.score);
        this.goBest.setAttribute('value', newBest ? 'NEW BEST!' : 'BEST  ' + this.highScore);
        this.goLevel.setAttribute('value', 'LEVEL REACHED  ' + this.level);
        this.hudRoot.setAttribute('visible', 'false');
        this.gameOverRoot.setAttribute('visible', 'true');
        AUDIO.sfxGameOver();
        if (newBest) this.setT(() => AUDIO.sfxSparkle(), 900);
        // Hand control back to the host: it runs the OUT transition (veil →
        // unmount → room reforms). All teardown happens in unmount().
        this.setT(() => {
          if (this.gameOverRoot) this.gameOverRoot.setAttribute('visible', 'false');
          if (this.ctx && this.ctx.requestExit) this.ctx.requestExit();
        }, 6000);
      },

      // ─── WIN LEVEL ─────────────────────────────────────────────────
      winLevel: function () {
        const t = (performance.now() - this.levelStartTime) / 1000;
        const timeBonus = Math.max(0, Math.floor(45 - t)) * 5;  // par 45 s
        this.addScore(100 * this.level + timeBonus);
        this.showPopup(this.bonusPopup,
          `+${100 * this.level}${timeBonus ? '  TIME +' + timeBonus : ''}`, '#fbbf24');
        this.burstConfetti();
        this.persistBest();
        if (this.level % 5 === 0) AUDIO.sfxLevelUp(); else AUDIO.sfxGoal();

        this.level++;
        AUDIO.setTempoForLevel(this.level);
        AUDIO.updateAmbience('safe');

        // Day → dusk → night rotation.
        const newBand = this.getBand(this.level);
        if (newBand !== this.band) {
          this.palFrom = PALETTES[this.band];
          this.palTo = PALETTES[newBand];
          this.palT = 0;
          this.band = newBand;
        }

        // Seamless transition — the goal strip IS the next stage's start strip.
        this.levelStartZ = this.getStageStartZ(this.level);
        this.playerLane = 0;
        this.onLog = false;
        this.currentLogRef = null;
        this.maxLaneReached = 0;
        this.levelStartTime = performance.now();
        this.removeStage(this.level - 2);
        this.buildStage(this.level + 1);
        this.updateHud();
        this.updatePlayerPosition();
        this.showLevelLabel();
      }
    });

    /* ══════════════════════════════════════════════════════════════════
       GAMES ROOM MODULE REGISTRATION
       A thin factory that wraps the A-Frame component in the host's
       mount/start/unmount lifecycle. One fresh instance per session.
       ══════════════════════════════════════════════════════════════════ */
    function registerWithHost() {
      if (!window.GamesHost || typeof window.GamesHost.register !== 'function') return false;
      window.GamesHost.register('frogger', {
        create: function (ctx) {
          var el = null, comp = null;
          return {
            mount: function () {
              return new Promise(function (resolve, reject) {
                el = document.createElement('a-entity');
                el.setAttribute('frogger-game', '');
                ctx.root.appendChild(el);
                var ready = function () {
                  // A listener throw is swallowed by the event dispatcher, so
                  // catch it and reject — the host then _aborts cleanly instead
                  // of the mount Promise hanging (frozen lobby behind the veil).
                  try { comp = el.components['frogger-game']; comp.mount(ctx); resolve(); }
                  catch (e) { reject(e); }
                };
                if (el.hasLoaded) ready();
                else el.addEventListener('loaded', ready, { once: true });
              });
            },
            start: function () { if (comp) comp.start(); },
            pause: function () { if (comp && comp.pauseGame) comp.pauseGame(); },
            resume: function () { if (comp && comp.resumeGame) comp.resumeGame(); },
            unmount: function () {
              if (comp) comp.unmount();
              if (el && el.parentNode) el.parentNode.removeChild(el);
              el = null; comp = null;
            }
          };
        }
      });
      return true;
    }
    if (!registerWithHost()) {
      window.addEventListener('gameshost-ready', registerWithHost, { once: true });
    }
})();
