// script.js
// DOM-based game logic: screen transitions, simple game mechanics, and localStorage persistence.
// Comments are intentionally beginner-friendly.

document.addEventListener('DOMContentLoaded', () => {
  // -- Elements
  const screen1 = document.getElementById('screen-1');
  const screen2 = document.getElementById('screen-2');
  const startBtn = document.getElementById('startBtn');
  const loadBtn = document.getElementById('loadBtn');
  const backBtn = document.getElementById('backBtn');

  // Game state with defaults
  const state = {
    funds: 100,
    waterDelivered: 0,
    selectedTool: null,
    placedItems: [],
    missionActive: false,
    missionTimeLeft: 0,
    achievements: [],
    // new fields: difficulty and active challenge info
    difficulty: 'normal',
    activeChallenge: null,
    challengeProgress: {},
  };

  // Attempt to load saved state from localStorage
  try {
    const saved = localStorage.getItem('charity-game-state');
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(state, parsed);
    }
  } catch (e) {
    console.warn('Failed to load saved state', e);
  }

  // Ensure configuration defaults exist (can be tuned via the in-UI config panel)
  if (!state.config) state.config = {
    enemyCounts: { easy: 0, normal: 2, hard: 4 },
    enemyDensity: 'auto', // auto uses enemyCounts, otherwise low/normal/high
    theftChance: { easy: 0, normal: 0.10, hard: 0.25 }
  };

  // Helper to place a specific item on a tile index (used by click and drop)
  function placeItemOnTile(index, item, tileEl) {
    if (!item) return;
    const tile = tileEl || worldInner && worldInner.querySelector(`.map-tile[data-index="${index}"]`);
    const existing = state.placedItems.find(p => p.index === index);
    if (existing) {
  const refund = Math.ceil(existing.item.cost / 2);
  state.funds += refund;
      state.placedItems = state.placedItems.filter(p => p.index !== index);
      if (tile) { tile.classList.remove('placed'); tile.querySelector('.tile-item').textContent = ''; }
      updateInventory(); updateHUD(); saveState();
  statusTextEl.textContent = `Removed ${existing.item.name} from this plot. Refunded ${refund} crowns.`;
      try { sound.play('place'); } catch (e) {}
      return;
    }

    if (state.funds < item.cost) {
      statusTextEl.textContent = "You don't have enough funds for that item.";
      return;
    }

    state.funds -= item.cost;
    state.placedItems.push({ index, item: item });
    if (tile) { tile.classList.add('placed'); tile.querySelector('.tile-item').textContent = item.name; }
    updateInventory(); updateHUD(); saveState();
    statusTextEl.textContent = `${item.name} placed on Plot ${index + 1}. Click again to remove (partial refund).`;
    try { sound.play('place'); } catch (e) {}
    // challenge progress: placing counts as progress for certain challenges
    updateChallengeProgress('place', 1, { itemId: item.id });
  }

  // Simple UI caches used in screen2
  const fundsEl = document.getElementById('funds');
  const waterEl = document.getElementById('waterDelivered');
  const shopListEl = document.getElementById('shopList');
  const inventoryEl = document.getElementById('inventoryList');
  const mapGridEl = document.getElementById('mapGrid');
  const statusTextEl = document.getElementById('statusText');
  const deliverBtn = document.getElementById('deliverWater');
  const playerNameEl = document.getElementById('playerName');
  const playerAvatarEl = document.getElementById('playerAvatar');

  function logDebug(msg) {
    // debug helper removed — kept as a no-op to avoid runtime errors if calls remain
    // (originally showed a small on-page debug banner during development)
    // console.log('[DEBUG]', msg);
  }

  // Shop items (medieval-themed names; effects keep the same shape for the prototype)
  const shopItems = [
    { id: 'waterskin', name: "Waterskin (Leather)", cost: 8, effect: { water: 5 } },
    { id: 'handaxe', name: "Peasant's Handaxe", cost: 35, effect: { water: 18 } },
    { id: 'rope', name: 'Braided Rope', cost: 12, effect: { water: 0 } },
  ];

  // Map dimensions
  const MAP_COLS = 6;
  const MAP_ROWS = 4;
  const totalTiles = MAP_COLS * MAP_ROWS;

  // Small list of hamlet/plot names for display (Option 1: light naming)
  const PLOT_NAMES = [
    'North Pasture','Old Mill','Bakers\' Row','Riverbank','Hillstead','Greenway',
    'Stonebridge','East Field','West Orchard','Fisher\'s Cove','Town Square','Lower Farm',
    'Upper Meadow','Shepherd\'s Hill','The Ditch','Willow End','Crow\'s Hollow','Amber Lea','Long Acre','Market Lane','Quarry','Fox Run','Ironford','Deepwell'
  ];

  // Tile pixel size used for the immersive world
  const TILE_W = 140;
  const TILE_H = 90;

  // World DOM pieces that will be created/managed by renderMap
  let worldInner = null;
  let playerEl = null;
  // camera state for smooth tweening
  let cameraX = 0;
  let cameraY = 0;
  // animation handles so we can cancel
  let _playerAnim = null;
  let _cameraAnim = null;

  // Simple rAF tween utility (returns a promise)
  function tween({ from, to, duration = 240, ease = t => (--t)*t*t+1, onUpdate }) {
    return new Promise(resolve => {
      const start = performance.now();
      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const v = ease(t);
        const current = from + (to - from) * v;
        if (onUpdate) onUpdate(current);
        if (t < 1) {
          const id = requestAnimationFrame(frame);
          // store last id to allow cancellation if needed
          _playerAnim = id;
        } else {
          _playerAnim = null;
          resolve();
        }
      }
      frame(start);
    });
  }

  // Player position (grid index). Persisted in state.playerPosIndex
  if (typeof state.playerPosIndex === 'undefined' || state.playerPosIndex === null) {
    // default to center tile
    state.playerPosIndex = Math.floor(totalTiles / 2);
  }

  // Quest NPC: a single NPC tile index and availability flag
  if (typeof state.questNpcIndex === 'undefined' || state.questNpcIndex === null) {
    // place NPC near the top-left for accessibility
    state.questNpcIndex = 1;
  }
  if (typeof state.questAvailable === 'undefined' || state.questAvailable === null) {
    state.questAvailable = true;
  }

  // Migrate to multi-NPC support: maintain backward compatibility with older saved state
    if (!Array.isArray(state.npcs) || state.npcs.length === 0) {
    state.npcs = [];
    const avatarPool = ['👵','👨‍🌾','👩‍🌾','🧑‍🌾','👩','👨','🧑','🧓'];
    // helper to build a simple quest object
    function makeQuest(type) {
      if (type === 'place') return { type: 'place', target: 3, rewardCrowns: 20, desc: 'Place 3 items on nearby plots.' };
      // default deliver
      return { type: 'deliver', target: 12, rewardCrowns: 45, rewardWater: 12, desc: 'Deliver aid to the villager.' };
    }

    if (typeof state.questNpcIndex !== 'undefined' && state.questNpcIndex !== null) {
      // migrate old single NPC into the new structure with a default quest
      state.npcs.push({ id: 'npc-1', index: state.questNpcIndex, available: !!state.questAvailable, accepted: !!state.questAccepted, name: 'Villager', avatar: '👵', quest: makeQuest('deliver') });
    } else {
      // seed a few NPCs at random positions (avoid player's tile) and give each a small quest
      const names = ['Marta','Gareth','Hilde','Roland','Alda','Beric','Lisbet'];
      const availablePos = [];
      for (let i = 0; i < totalTiles; i++) if (i !== state.playerPosIndex) availablePos.push(i);
      const npcCount = Math.min(4, Math.max(1, Math.floor(availablePos.length / 6)));
      for (let i = 0; i < npcCount; i++) {
        const idx = Math.floor(Math.random() * availablePos.length);
        const pos = availablePos.splice(idx, 1)[0];
        const name = names[i % names.length];
        const avatar = avatarPool[i % avatarPool.length];
        const qtype = (i % 2 === 0) ? 'deliver' : 'place';
        state.npcs.push({ id: `npc-${i+1}`, index: pos, available: true, accepted: false, name: name, avatar: avatar, quest: makeQuest(qtype) });
      }
    }
  }

  // Simple loader implementation using the small overlay added to index.html
  // Inline indicator implementation (non-blocking)
  const inlineIndicator = document.getElementById('inlineIndicator');
  const inlineText = document.getElementById('inlineIndicatorText');
  const inlinePct = document.getElementById('inlineIndicatorPct');
  let _indicatorRaf = null;
  // Jerrycan SVG elements (decorative). We'll update the water rect attributes directly.
  const jerrySvg = document.getElementById('jerrySvg');
  const jerryWater = document.getElementById('jerryWater');
  const JERRY_TOTAL_H = 30; // matches SVG body height used in markup
  const JERRY_TOP_Y = 6; // top offset of the water area in the SVG
  let _jerryRaf = null;

  function setJerryPercent(pct) {
    if (!jerryWater) return;
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    const height = Math.round((clamped / 100) * JERRY_TOTAL_H);
    const y = JERRY_TOP_Y + (JERRY_TOTAL_H - height);
    try {
      jerryWater.setAttribute('height', String(height));
      jerryWater.setAttribute('y', String(y));
    } catch (e) {
      // ignore if attribute setting fails in some environment
    }
  }

  // --- New: Challenges and Achievements data (small, beginner-friendly)
  // Challenge pool: we'll pick a small rotating subset each day/session to keep things fresh
  const CHALLENGE_POOL = [
    { id: 'c_deliver10', title: 'Deliver 10 Supplies', desc: 'Deliver 10 supplies via Deliver action.', type: 'deliver', target: 10, rewardGold: 40 },
    { id: 'c_place3', title: 'Place 3 Items', desc: 'Place 3 items on the map (any).', type: 'place', target: 3, rewardGold: 25 },
    { id: 'c_deliver5', title: 'Quick Deliver', desc: 'Deliver 5 supplies in one session.', type: 'deliver', target: 5, rewardGold: 20 },
    { id: 'c_place1', title: 'First Placement', desc: 'Place your first item on the map.', type: 'place', target: 1, rewardGold: 8 },
    { id: 'c_place5', title: 'Builder', desc: 'Place 5 items on the map.', type: 'place', target: 5, rewardGold: 45 },
    { id: 'c_deliver20', title: 'Generous Aid', desc: 'Deliver 20 supplies (accumulated).', type: 'deliver', target: 20, rewardGold: 80 },
  ];

  // Achievement mapping for display
  const ACHIEVEMENT_DEFS = {
    '100S': { name: '100 Supplies', desc: 'Delivered 100 supplies in total.' },
    'PLACED1': { name: 'First Placement', desc: 'Placed your first item on the map.' },
  };

  // Choose a small rotating subset of challenges per session (random each page load)
  function seedSessionChallenges() {
    // If already seeded this session, keep it
    if (Array.isArray(state.sessionChallenges) && state.sessionChallenges.length) return;
    const pool = CHALLENGE_POOL.slice();
    const pickCount = Math.min(3, pool.length);
    const chosen = [];
    for (let i = 0; i < pickCount; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      chosen.push(pool.splice(idx, 1)[0]);
    }
    // sessionChallenges are not persisted so they'll rotate each page load
    state.sessionChallenges = chosen;
  }

  // Enemy system: basic session-only enemy placement that can steal funds or placed items
  const ENEMY_TYPES = [
    { id: 'thief', name: 'Thief' },
    { id: 'raider', name: 'Raider' }
  ];

  function spawnEnemiesForSession() {
    // ensure we only spawn once per session unless map re-renders and we want to respawn
    if (Array.isArray(state.enemyTiles) && state.enemyTiles.length) return;
    state.enemyTiles = [];
    // compute count using config overrides where present
    let base = (state.config && state.config.enemyCounts && typeof state.config.enemyCounts.normal === 'number') ? state.config.enemyCounts.normal : 2;
    let count = 0;
    const den = (state.config && state.config.enemyDensity) ? state.config.enemyDensity : 'auto';
    if (den === 'low') count = Math.max(0, base - 1);
    else if (den === 'normal') count = base;
    else if (den === 'high') count = base + 2;
    else {
      // auto: use per-difficulty mapping from config if available
      if (state.difficulty === 'easy') count = (state.config && state.config.enemyCounts && typeof state.config.enemyCounts.easy === 'number') ? state.config.enemyCounts.easy : 0;
      else if (state.difficulty === 'normal') count = (state.config && state.config.enemyCounts && typeof state.config.enemyCounts.normal === 'number') ? state.config.enemyCounts.normal : 2;
      else if (state.difficulty === 'hard') count = (state.config && state.config.enemyCounts && typeof state.config.enemyCounts.hard === 'number') ? state.config.enemyCounts.hard : 4;
    }
  // forbid player tile and any NPC tiles
  const npcIndices = Array.isArray(state.npcs) ? state.npcs.map(n=>n.index) : [];
  const forbidden = new Set([state.playerPosIndex].concat(npcIndices));
    const available = [];
    for (let i = 0; i < totalTiles; i++) if (!forbidden.has(i)) available.push(i);
    for (let i = 0; i < count && available.length; i++) {
      const idx = Math.floor(Math.random() * available.length);
      state.enemyTiles.push(available.splice(idx, 1)[0]);
    }
  }

  function handleEncounter(index) {
    if (!state.enemyTiles || !state.enemyTiles.includes(index)) return;
    // remove enemy after encounter
    state.enemyTiles = state.enemyTiles.filter(i => i !== index);
    // if there's a placed item here, it's stolen
    const placed = state.placedItems.find(p => p.index === index);
    if (placed) {
      // remove item without refund to simulate theft
      state.placedItems = state.placedItems.filter(p => p.index !== index);
      statusTextEl.textContent = `A bandit stole the ${placed.item.name} from Plot ${index + 1}!`;
      try { sound.play('place'); } catch (e) {}
      saveState(); renderMap(); updateInventory(); updateHUD();
      return;
    }
    // otherwise steal some funds (configurable)
    const theftConf = (state.config && state.config.theftChance) ? state.config.theftChance : { easy:0, normal:0.1, hard:0.25 };
    const mult = (typeof theftConf[state.difficulty] === 'number') ? theftConf[state.difficulty] : (state.difficulty === 'hard' ? 0.2 : 0.1);
  const lost = Math.max(1, Math.round(state.funds * mult));
  state.funds = Math.max(0, state.funds - lost);
  statusTextEl.textContent = `Robbers relieved you of ${lost} crowns! Stay vigilant.`;
    try { sound.play('place'); } catch (e) {}
    saveState(); updateHUD();
  }

  function animateJerryTo(targetPct, durationMs = 180) {
    if (!jerryWater) return;
    if (_jerryRaf) cancelAnimationFrame(_jerryRaf);
    const start = performance.now();
    const currentH = parseInt(jerryWater.getAttribute('height') || '0', 10);
    const initialPct = Math.round((currentH / JERRY_TOTAL_H) * 100);
    function step(now) {
      const t = Math.min(1, (now - start) / durationMs);
      const pct = Math.round(initialPct + (targetPct - initialPct) * t);
      setJerryPercent(pct);
      if (t < 1) {
        _jerryRaf = requestAnimationFrame(step);
      }
    }
    _jerryRaf = requestAnimationFrame(step);
  }

  function showIndicator(message = 'Loading...', durationMs = 600, taskPromise = null) {
    if (!inlineIndicator) return Promise.resolve();
    inlineText.textContent = message;
    if (inlinePct) inlinePct.textContent = '0%';
    inlineIndicator.classList.remove('hidden');
    inlineIndicator.setAttribute('aria-hidden', 'false');

    // If provided a taskPromise, wait for it to settle; otherwise simulate progress
    if (taskPromise && typeof taskPromise.then === 'function') {
      // Optionally show indeterminate state; we'll keep percent at 0 until settled
      return taskPromise.finally(() => { hideIndicator(); });
    }

    return new Promise(resolve => {
      const start = performance.now();
        function step(now) {
          const t = Math.min(1, (now - start) / durationMs);
          const pct = Math.round(t * 100);
          if (inlinePct) inlinePct.textContent = pct + '%';
          // Update decorative jerrycan to match percent
          try { animateJerryTo(pct, 120); } catch (e) { /* ignore */ }
          if (t < 1) {
            _indicatorRaf = requestAnimationFrame(step);
          } else {
            // ensure full fill briefly before hiding
            try { animateJerryTo(100, 120); } catch (e) {}
            setTimeout(() => { hideIndicator(); resolve(); }, 180);
          }
        }
        _indicatorRaf = requestAnimationFrame(step);
    });
  }

  function updateIndicator(pct) {
    if (!inlineIndicator || inlineIndicator.classList.contains('hidden')) return;
    if (!inlinePct) return;
    inlinePct.textContent = `${Math.min(100, Math.max(0, Math.round(pct)))}%`;
  }

  function hideIndicator() {
    if (!inlineIndicator) return;
    inlineIndicator.classList.add('hidden');
    inlineIndicator.setAttribute('aria-hidden', 'true');
    if (inlinePct) inlinePct.textContent = '0%';
    if (_indicatorRaf) { cancelAnimationFrame(_indicatorRaf); _indicatorRaf = null; }
    // reset jerry water to empty
    try { setJerryPercent(0); } catch (e) {}
    if (_jerryRaf) { cancelAnimationFrame(_jerryRaf); _jerryRaf = null; }
  }

  // Keep the old loader API but wire to inline indicator (returns a Promise)
  function showLoading(message = 'Loading...', durationMs = 300, taskPromise = null) {
    return showIndicator(message, durationMs, taskPromise);
  }

  function hideLoading() {
    hideIndicator();
  }

  function saveState() {
    try {
      localStorage.setItem('charity-game-state', JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save state', e);
    }
  }

  // Utility: get difficulty multiplier (used for rewards and water yields)
  function difficultyMultiplier() {
    if (!state.difficulty) return 1.0;
    if (state.difficulty === 'easy') return 1.2;
    if (state.difficulty === 'hard') return 0.8;
    return 1.0;
  }

  // --------------------------
  // Sound manager (WebAudio + synth fallback)
  // --------------------------
  const soundKey = 'charity-sound-settings';
  const sound = {
    ctx: null,
    master: null,
    volume: 0.8,
    muted: false,
    inited: false,
    init() {
      if (this.inited) return;
      try {
        const C = window.AudioContext || window.webkitAudioContext;
        this.ctx = new C();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(this.ctx.destination);
        this.inited = true;
      } catch (e) {
        console.warn('WebAudio not available', e);
      }
    },
      // HTMLAudio fallback (tiny silent WAV) to unlock audio on strict browsers
      audioFallback: (function(){
        try {
          const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=');
          a.preload = 'auto';
          return a;
        } catch(e) { return null; }
      })(),
    setVolume(v) {
      this.volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
      this.save();
    },
    setMuted(m) {
      this.muted = !!m;
      if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
      this.save();
    },
    save() { try { localStorage.setItem(soundKey, JSON.stringify({ muted: this.muted, volume: this.volume })); } catch (e) {} },
    restore() {
      try {
        const s = JSON.parse(localStorage.getItem(soundKey) || 'null');
        if (s) { this.muted = !!s.muted; this.volume = typeof s.volume === 'number' ? s.volume : this.volume; }
      } catch (e) {}
    },
    play(name) {
      if (this.muted) return;
      try { this.init(); } catch (e) { return; }
      // Some browsers suspend the AudioContext until a user gesture; attempt to resume so short SFX still play
      try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); } catch (e) {}
      // If there is no AudioContext (older browsers) or resume didn't succeed, try HTMLAudio fallback
      if (!this.ctx) {
        if (this.audioFallback) { try { this.audioFallback.currentTime = 0; this.audioFallback.play().catch(()=>{}); } catch(e){} }
        return;
      }
      if (this.ctx && this.ctx.state !== 'running' && this.audioFallback) {
        try { this.audioFallback.currentTime = 0; this.audioFallback.play().catch(()=>{}); } catch(e){}
      }
      // simple synth effects for common events
      const now = this.ctx.currentTime;
      if (name === 'move') {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(880, now);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.12 * this.volume, now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        o.connect(g); g.connect(this.master);
        o.start(now); o.stop(now + 0.22);
        return;
      }
      if (name === 'place') {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(520, now);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.16 * this.volume, now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        o.connect(g); g.connect(this.master);
        o.start(now); o.stop(now + 0.3);
        return;
      }
      if (name === 'deliver') {
        // simple arpeggiated chime
        const freqs = [660, 880, 990];
        freqs.forEach((f, i) => {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          const t = now + i * 0.06;
          o.type = 'sine'; o.frequency.setValueAtTime(f, t);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.18 * this.volume, t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
          o.connect(g); g.connect(this.master);
          o.start(t); o.stop(t + 0.36);
        });
        return;
      }
      if (name === 'questComplete') {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(440, now);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.22 * this.volume, now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        o.connect(g); g.connect(this.master);
        o.start(now); o.stop(now + 0.56);
        return;
      }
      // fallback click sound
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(880, now);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.08 * this.volume, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      o.connect(g); g.connect(this.master);
      o.start(now); o.stop(now + 0.14);
    }
  };
  // restore sound settings from last session
  sound.restore();

  // --------------------------
  // YouTube background music (shuffle playlist)
  // --------------------------
  // List of YouTube URLs provided by the user; we'll extract IDs and shuffle play them
  const ytUrls = [
    'https://youtu.be/V7jOobdrdGo',
    'https://youtu.be/u9eSnSBP1Po',
    'https://youtu.be/Nx-x_1lIXh4',
    'https://youtu.be/cRIfsFefatg',
    'https://youtu.be/X8u15Q99HUU',
    'https://youtu.be/GZU-rn8ucSo'
  ];
  const ytQueue = ytUrls.map(u => extractYouTubeId(u)).filter(Boolean);
  let ytPlayer = null;
  let ytApiReady = false;
  let ytCreating = false;

  function extractYouTubeId(url) {
    if (!url) return null;
    // common patterns: youtu.be/ID, v=ID, /embed/ID
    const m = url.match(/(?:v=|\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : null;
  }

  function loadYouTubeApi() {
    return new Promise(resolve => {
      if (window.YT && window.YT.Player) { ytApiReady = true; return resolve(); }
      if (document.getElementById('youtube-iframe-api')) { // already loading
        const check = setInterval(() => { if (window.YT && window.YT.Player) { clearInterval(check); ytApiReady = true; resolve(); } }, 200);
        return;
      }
      const tag = document.createElement('script');
      tag.id = 'youtube-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = function() { ytApiReady = true; resolve(); };
    });
  }

  function createYtPlayer() {
    if (ytPlayer || ytCreating) return Promise.resolve();
    ytCreating = true;
    return loadYouTubeApi().then(() => new Promise(resolve => {
      const container = document.getElementById('yt-music-container');
      // create a hidden player (0x0 dimensions) so audio plays but UI is invisible
      ytPlayer = new YT.Player(container, {
        height: '0', width: '0',
        videoId: ytQueue.length ? ytQueue[0] : undefined,
        playerVars: {
          autoplay: 0,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          disablekb: 1
        },
        events: {
          onReady: (e) => {
            try { if (typeof e.target.setVolume === 'function') e.target.setVolume(Math.round(sound.volume * 100)); } catch (e) {}
            // update now-playing with initial video title if available
            try { updateNowPlaying(e.target.getVideoData && e.target.getVideoData().title); } catch (err) {}
            resolve();
          },
          onStateChange: (e) => {
            // update title and musicPlaying flag when the player state changes
            try {
              if (typeof YT !== 'undefined') {
                if (e.data === YT.PlayerState.PLAYING) {
                  musicPlaying = true;
                  if (musicToggleBtn) musicToggleBtn.textContent = 'Still the Minstrels';
                  try { updateNowPlaying(ytPlayer.getVideoData && ytPlayer.getVideoData().title); } catch (err) {}
                } else if (e.data === YT.PlayerState.PAUSED) {
                  musicPlaying = false;
                  if (musicToggleBtn) musicToggleBtn.textContent = 'Let Music Play';
                } else if (e.data === YT.PlayerState.ENDED) {
                  musicPlaying = false;
                  if (musicToggleBtn) musicToggleBtn.textContent = 'Let Music Play';
                  // small timeout to avoid immediate rapid-fire
                  setTimeout(() => { playNextYt(); }, 220);
                }
              }
            } catch (err) {
              // ignore
            }
          }
        }
      });
    })).finally(() => { ytCreating = false; });
  }

  function playNextYt() {
    if (!ytPlayer || !ytQueue.length) return;
    try {
      const curId = ytPlayer.getVideoData && ytPlayer.getVideoData().video_id;
      // pick a random different index
      let idx = Math.floor(Math.random() * ytQueue.length);
      if (ytQueue.length > 1) {
        const maxTries = 6; let tries = 0;
        while (ytQueue[idx] === curId && tries++ < maxTries) idx = Math.floor(Math.random() * ytQueue.length);
      }
      const nextId = ytQueue[idx];
      if (!nextId) return;
      // load and play
      if (typeof ytPlayer.loadVideoById === 'function') {
        ytPlayer.loadVideoById({ videoId: nextId, startSeconds: 0 });
        try { ytPlayer.playVideo(); } catch (e) {}
      } else if (typeof ytPlayer.cueVideoById === 'function') {
        ytPlayer.cueVideoById(nextId);
        try { ytPlayer.playVideo(); } catch (e) {}
      }
      // update now-playing title (will be refined when playing state is reached)
      try { updateNowPlaying(ytPlayer && ytPlayer.getVideoData && ytPlayer.getVideoData().title); } catch (e) {}
    } catch (e) {
      // ignore YouTube API errors
    }
  }

  // Update the now-playing UI element (uses medieval font via CSS)
  const nowPlayingEl = document.getElementById('nowPlaying');
  function updateNowPlaying(title) {
    if (!nowPlayingEl) return;
    if (!title) {
      nowPlayingEl.style.display = 'none';
      nowPlayingEl.textContent = '';
      return;
    }
    nowPlayingEl.textContent = title;
    nowPlayingEl.style.display = 'inline-block';
  }



  // Reset game progress. If wipeCharacter is true, also remove saved name/avatar.
  // Respawn player to default and play a small respawn animation.
  function resetGame(wipeCharacter = false) {
    const keepName = (!wipeCharacter && state.playerName) ? state.playerName : null;
    const keepAvatar = (!wipeCharacter && state.avatar) ? state.avatar : null;
    // Reset fields to defaults
    state.funds = 100;
    state.waterDelivered = 0;
    state.selectedTool = null;
    state.placedItems = [];
    state.missionActive = false;
    state.missionTimeLeft = 0;
    state.achievements = [];
    // Reset per-NPC quest state (mark all NPCs as available again)
    if (Array.isArray(state.npcs)) {
      state.npcs.forEach(n => { n.available = true; n.accepted = false; });
    }
    // legacy flags (for older saves) - clear to avoid confusion
    state.questAvailable = true; state.questAccepted = false;
    // Reset player pos to center
    state.playerPosIndex = Math.floor(totalTiles / 2);
    // restore character if requested to keep
    if (keepName) state.playerName = keepName; else delete state.playerName;
    if (keepAvatar) state.avatar = keepAvatar; else delete state.avatar;
    saveState();
    // Re-render UI
    renderShop();
    renderMap();
    updateInventory();
    updateHUD();
    // close any open dialogs
    try { hideNpcDialog(); } catch (e) {}
    if (statusTextEl) statusTextEl.textContent = 'Progress cleared. Player respawned.';
    // Play respawn animation on the player element if available
    try {
      if (playerEl) {
        playerEl.classList.remove('respawn');
        // trigger reflow then add
        // eslint-disable-next-line no-unused-expressions
        void playerEl.offsetWidth;
        playerEl.classList.add('respawn');
        // remove class after animation completes
        setTimeout(() => { if (playerEl) playerEl.classList.remove('respawn'); }, 700);
      }
    } catch (e) {
      // ignore animation errors
    }
  }

  function updateHUD() {
    fundsEl.textContent = state.funds;
    waterEl.textContent = state.waterDelivered;
    if (playerNameEl) playerNameEl.textContent = state.playerName || 'Player 1';
    if (playerAvatarEl) {
      playerAvatarEl.textContent = state.avatar || '';
      playerAvatarEl.classList.toggle('has-avatar', !!state.avatar);
    }
  }

  function renderShop() {
    if (!shopListEl) return;
    shopListEl.innerHTML = '';
    shopItems.forEach(item => {
      const itemEl = document.createElement('div');
      itemEl.className = 'shop-item';
      itemEl.setAttribute('draggable', 'true');
      itemEl.dataset.itemId = item.id;
      itemEl.innerHTML = `
        <div class="meta">
            <strong>${item.name}</strong><div style="font-size:0.85rem;color:#6b7280;">${item.cost} crowns</div>
        </div>
      `;
      const buyBtn = document.createElement('button');
      buyBtn.className = 'btn';
      buyBtn.textContent = 'Select';
      buyBtn.addEventListener('click', () => {
        state.selectedTool = item;
    statusTextEl.textContent = `Selected: ${item.name}. Click a map tile to place it.`;
        Array.from(shopListEl.querySelectorAll('.shop-item')).forEach(el => el.style.boxShadow = '');
        itemEl.style.boxShadow = '0 0 0 2px rgba(14,165,164,0.14)';
      });
      // drag support: set the dataTransfer payload to the item id
      itemEl.addEventListener('dragstart', (ev) => {
        try { ev.dataTransfer.setData('text/plain', item.id); ev.dataTransfer.effectAllowed = 'copy'; } catch (e) {}
      });
      itemEl.appendChild(buyBtn);
      shopListEl.appendChild(itemEl);
    });
  }

  function renderMap() {
    if (!mapGridEl) return;
    // create the inner world container (big virtual map)
    mapGridEl.innerHTML = '';
    worldInner = document.createElement('div');
    worldInner.className = 'world-inner';
    // size the world according to tile counts
    worldInner.style.width = `${MAP_COLS * TILE_W}px`;
    worldInner.style.height = `${MAP_ROWS * TILE_H}px`;

    for (let i = 0; i < totalTiles; i++) {
      const x = i % MAP_COLS;
      const y = Math.floor(i / MAP_COLS);
      const tile = document.createElement('div');
      tile.className = 'map-tile';
      tile.dataset.x = String(x);
      tile.dataset.y = String(y);
      tile.dataset.index = i;
      tile.style.left = `${x * TILE_W + 12}px`;
      tile.style.top = `${y * TILE_H + 12}px`;
      tile.style.width = `${TILE_W - 24}px`;
      tile.style.height = `${TILE_H - 24}px`;
  const plotName = PLOT_NAMES[i % PLOT_NAMES.length] || `Field ${i+1}`;
  // show only the plot name (no 'Plot N' prefix) to avoid overflow when items are placed
  tile.innerHTML = `<div class="tile-label" title="${plotName}">${plotName}</div><div class="tile-item"></div>`;
      tile.addEventListener('click', () => onMapTileClick(i, tile));
      // drag & drop support so players can drag items from the shop onto a tile
      tile.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer && (e.dataTransfer.dropEffect = 'copy'); tile.classList.add('drop-target'); });
      tile.addEventListener('dragleave', (e) => { tile.classList.remove('drop-target'); });
      tile.addEventListener('drop', (e) => {
        e.preventDefault(); tile.classList.remove('drop-target');
        let itemId = null;
        try { itemId = e.dataTransfer.getData('text/plain'); } catch (err) {}
        if (!itemId) return;
        const dragged = shopItems.find(s => s.id === itemId);
        if (!dragged) return;
        // place the dragged item directly onto this tile (acts like selecting + clicking)
        placeItemOnTile(i, dragged, tile);
      });
      const placed = state.placedItems.find(p => p.index === i);
      if (placed) {
        tile.classList.add('placed');
        tile.querySelector('.tile-item').textContent = placed.item.name;
      }
      worldInner.appendChild(tile);
    }

    // add worldInner to the viewport
    mapGridEl.appendChild(worldInner);

    // spawn enemies for this session and mark tiles visually
    try { spawnEnemiesForSession(); } catch (e) {}
    if (Array.isArray(state.enemyTiles)) {
      state.enemyTiles.forEach(idx => {
        const t = worldInner.querySelector(`.map-tile[data-index="${idx}"]`);
        if (t) {
          t.classList.add('enemy');
          // small enemy marker
          let m = t.querySelector('.enemy-marker');
          if (!m) {
            m = document.createElement('div'); m.className = 'enemy-marker'; m.textContent = '⚔️';
            t.appendChild(m);
          }
        }
      });
    }

    // create or update player element (use inline SVG sprite for a medieval look)
    if (!playerEl) {
      playerEl = document.createElement('div');
      playerEl.className = 'player-entity';
      playerEl.id = 'playerEntity';
      // simple medieval tunic SVG as a tiny sprite
      playerEl.innerHTML = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <g fill="none" fill-rule="evenodd">
            <path d="M6 8c0 3 6 6 6 6s6-3 6-6v-3l-3-2-3 1-3-1-3 2v3z" fill="#f97316"/>
            <circle cx="12" cy="4" r="2" fill="#fde68a"/>
            <path d="M8 14c0 1.5 4 3 4 3s4-1.5 4-3v4H8v-4z" fill="#fff" opacity="0.9"/>
          </g>
        </svg>`;
      worldInner.appendChild(playerEl);
    } else {
      if (!worldInner.contains(playerEl)) worldInner.appendChild(playerEl);
    }

    // Place the player at the saved index
    const px = state.playerPosIndex % MAP_COLS;
    const py = Math.floor(state.playerPosIndex / MAP_COLS);
  // position immediately on first render
  const startLeft = px * TILE_W + TILE_W / 2 - 23;
  const startTop = py * TILE_H + TILE_H / 2 - 23;
  playerEl.style.left = `${startLeft}px`;
  playerEl.style.top = `${startTop}px`;
  cameraX = 0; cameraY = 0;
    centerCameraOn(state.playerPosIndex, /*animate=*/false);
    // ensure background parallax starts in a neutral position
    try { updateParallax(cameraX, cameraY); } catch (e) {}

    // Render NPC entity
    renderNpc();
  }

  function renderNpc() {
    if (!worldInner || !Array.isArray(state.npcs)) return;
    // create or update npc elements for each NPC in state.npcs
    state.npcs.forEach(npcObj => {
      let el = worldInner.querySelector(`.npc-entity[data-npc-id="${npcObj.id}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'npc-entity';
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('data-npc-id', npcObj.id);
        // avatar (SVG image) shown in circle — generate unique placeholder SVG per NPC
        const avatar = document.createElement('div');
        avatar.className = 'npc-avatar';
        // create a simple SVG avatar with initial and colored background
        const initials = (npcObj.name || 'V').split(' ').map(s=>s[0]).slice(0,2).join('');
        const colors = ['#f97316','#ef4444','#10b981','#3b82f6','#a78bfa','#f59e0b'];
        const color = colors[(npcObj.id && npcObj.id.split('-').pop()) % colors.length] || colors[0];
        const svg = `
          <svg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 36 36'>
            <rect width='36' height='36' rx='8' fill='${color}' />
            <text x='50%' y='54%' font-size='14' font-family='Georgia, serif' fill='#fff' font-weight='700' text-anchor='middle' dominant-baseline='middle'>${initials}</text>
          </svg>`;
        avatar.innerHTML = svg;
        el.appendChild(avatar);
        const badge = document.createElement('div');
        badge.className = 'npc-indicator';
        el.appendChild(badge);
        // small tooltip for accessibility and hover
  const tip = document.createElement('div');
  tip.className = 'npc-tooltip';
  tip.textContent = `${npcObj.name} — ${npcObj.quest && npcObj.quest.desc ? npcObj.quest.desc : 'Seeks help'}`;
  el.appendChild(tip);
        // clicking the NPC opens the dialog for that NPC
        el.addEventListener('click', (ev) => {
          try { ev && ev.stopPropagation && ev.stopPropagation(); } catch (e) {}
          if (npcObj.available) showNpcDialog(npcObj.id);
        });
        worldInner.appendChild(el);
      } else {
        // ensure avatar and tooltip reflect any updates
        const avatar = el.querySelector('.npc-avatar'); if (avatar) avatar.textContent = npcObj.avatar || '👤';
        const tip = el.querySelector('.npc-tooltip'); if (tip) tip.textContent = `${npcObj.name} — ${npcObj.quest && npcObj.quest.desc ? npcObj.quest.desc : 'Seeks help'}`;
      }
  const idx = npcObj.index;
  const nx = idx % MAP_COLS;
  const ny = Math.floor(idx / MAP_COLS);
      // position element centered on tile
      el.style.left = `${nx * TILE_W + TILE_W / 2 - 18}px`;
      el.style.top = `${ny * TILE_H + TILE_H / 2 - 18}px`;
      const badge = el.querySelector('.npc-indicator');
      // add a bob class for subtle motion
      if (!el.classList.contains('bob')) el.classList.add('bob');
      if (npcObj.available) {
        badge.textContent = '❗';
        el.classList.remove('quest-complete');
        badge.title = npcObj.name + ' — Quest available';
      } else {
        badge.textContent = '✓';
        el.classList.add('quest-complete');
        badge.title = npcObj.name + ' — Quest completed';
      }
    });
  }

  // NPC dialog handlers
  const npcDialog = document.getElementById('npcDialog');
  const npcDialogText = document.getElementById('npcDialogText');
  const npcAcceptBtn = document.getElementById('npcAcceptBtn');
  const npcDeclineBtn = document.getElementById('npcDeclineBtn');
  const npcCloseBtn = document.getElementById('npcCloseBtn');
  // Reset confirmation dialog elements
  const confirmResetDialog = document.getElementById('confirmResetDialog');
  const wipeCharacterCheckbox = document.getElementById('wipeCharacterCheckbox');
  const resetCancelBtn = document.getElementById('resetCancelBtn');
  const resetConfirmBtn = document.getElementById('resetConfirmBtn');

  // Open NPC dialog for a given npcId
  function showNpcDialog(npcId) {
    if (!npcDialog) return;
    const npcObj = Array.isArray(state.npcs) ? state.npcs.find(n => n.id === npcId) : null;
    if (!npcObj) return;
    // remember which NPC is active in the dialog
    state.activeNpcId = npcObj.id;
    npcDialog.classList.remove('hidden');
    npcDialog.setAttribute('aria-hidden', 'false');
    // Compose dialog text using NPC-specific quest info when available
    const q = npcObj.quest || { type: 'deliver', target: 10, rewardCrowns: 30, desc: 'A local needs aid.' };
    if (npcObj.accepted) {
      npcDialogText.textContent = 'You have already accepted this quest. Return to the villager to hand it in.';
      npcAcceptBtn.textContent = 'Okay';
    } else {
      npcDialogText.textContent = `${npcObj.name} asks: ${q.desc} (${q.type === 'deliver' ? `Deliver ${q.target} aid` : `Place ${q.target} items`}). Reward: ${q.rewardCrowns} crowns.`;
      npcAcceptBtn.textContent = 'Accept Quest';
    }
  }

  function hideNpcDialog() {
    if (!npcDialog) return;
    npcDialog.classList.add('hidden');
    npcDialog.setAttribute('aria-hidden', 'true');
  }

  if (npcAcceptBtn) {
    npcAcceptBtn.addEventListener('click', () => {
      const npcObj = Array.isArray(state.npcs) ? state.npcs.find(n => n.id === state.activeNpcId) : null;
      if (npcObj && !npcObj.accepted) {
        npcObj.accepted = true;
        saveState();
        statusTextEl.textContent = `Quest accepted from ${npcObj.name}: bring aid to the villager.`;
      }
      hideNpcDialog();
    });
  }
  if (npcDeclineBtn) {
    npcDeclineBtn.addEventListener('click', () => {
      statusTextEl.textContent = 'You declined the villager. You can accept later.';
      hideNpcDialog();
    });
  }
  if (npcCloseBtn) {
    npcCloseBtn.addEventListener('click', () => hideNpcDialog());
  }

  // Show the confirm-reset modal and return a Promise resolving to {confirmed, wipe}
  function showConfirmReset() {
    return new Promise(resolve => {
      if (!confirmResetDialog) return resolve({ confirmed: false, wipe: false });
      // reset checkbox
      if (wipeCharacterCheckbox) wipeCharacterCheckbox.checked = false;
      confirmResetDialog.classList.remove('hidden');
      confirmResetDialog.setAttribute('aria-hidden', 'false');

      function cleanup() {
        confirmResetDialog.classList.add('hidden');
        confirmResetDialog.setAttribute('aria-hidden', 'true');
        resetConfirmBtn && resetConfirmBtn.removeEventListener('click', onConfirm);
        resetCancelBtn && resetCancelBtn.removeEventListener('click', onCancel);
      }

      function onConfirm(ev) {
        try { if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation(); } catch (e) {}
        const wipe = !!(wipeCharacterCheckbox && wipeCharacterCheckbox.checked);
        cleanup();
        resolve({ confirmed: true, wipe });
      }
      function onCancel(ev) {
        try { if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation(); } catch (e) {}
        cleanup();
        resolve({ confirmed: false, wipe: false });
      }

      resetConfirmBtn && resetConfirmBtn.addEventListener('click', onConfirm);
      resetCancelBtn && resetCancelBtn.addEventListener('click', onCancel);
    });
  }

  // center the viewport on a tile index. If animate=false, jump immediately.
  function centerCameraOn(index, animate = true) {
    if (!worldInner || !mapGridEl) return;
    const viewW = mapGridEl.clientWidth;
    const viewH = mapGridEl.clientHeight;
    const px = index % MAP_COLS;
    const py = Math.floor(index / MAP_COLS);
    const playerCenterX = px * TILE_W + TILE_W / 2;
    const playerCenterY = py * TILE_H + TILE_H / 2;
    const tx = Math.max(0, Math.min(playerCenterX - viewW / 2, Math.max(0, worldInner.clientWidth - viewW)));
    const ty = Math.max(0, Math.min(playerCenterY - viewH / 2, Math.max(0, worldInner.clientHeight - viewH)));
    if (animate === false) {
      cameraX = tx; cameraY = ty;
      worldInner.style.transform = `translate(${-tx}px, ${-ty}px)`;
      try { updateParallax(cameraX, cameraY); } catch (e) {}
      return;
    }
    // animate camera using rAF for smooth movement
    animateCameraTo(tx, ty);
  }

  // Subtle parallax: adjust map background-position based on camera position
  function updateParallax(cx, cy) {
    if (!mapGridEl || !worldInner) return;
    const maxPanX = Math.max(1, worldInner.clientWidth - mapGridEl.clientWidth);
    const maxPanY = Math.max(1, worldInner.clientHeight - mapGridEl.clientHeight);
    const parallaxX = 6; // percent max horizontal shift
    const parallaxY = 3; // percent max vertical shift
    const px = (cx / maxPanX) * parallaxX;
    const py = (cy / maxPanY) * parallaxY;
    const bgX = 50 - px; // center (50%) +/- small percent
    const bgY = 50 - py;
    mapGridEl.style.backgroundPosition = `${bgX}% ${bgY}%`;
  }

  function animateCameraTo(targetX, targetY, duration = 320) {
    if (!_cameraAnim && typeof worldInner.style.transform === 'string') {
      // parse current translate
      const m = worldInner.style.transform.match(/translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/);
      if (m) {
        cameraX = -parseFloat(m[1]);
        cameraY = -parseFloat(m[2]);
      } else {
        cameraX = cameraX || 0;
        cameraY = cameraY || 0;
      }
    }
    if (_cameraAnim) cancelAnimationFrame(_cameraAnim);
    const startX = cameraX;
    const startY = cameraY;
    const start = performance.now();
    return new Promise(resolve => {
      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        const easeT = (--t) * t * t + 1; // easeOut
        const curX = startX + (targetX - startX) * easeT;
        const curY = startY + (targetY - startY) * easeT;
        cameraX = curX; cameraY = curY;
        worldInner.style.transform = `translate(${-curX}px, ${-curY}px)`;
        // update parallax background to move subtly with camera
        try { updateParallax(cameraX, cameraY); } catch (e) { /* ignore in older browsers */ }
        if (t < 1) {
          _cameraAnim = requestAnimationFrame(step);
        } else {
          _cameraAnim = null;
          resolve();
        }
      }
      _cameraAnim = requestAnimationFrame(step);
    });
  }

  // Ensure the player element remains within the visible viewport; adjust camera immediately if needed
  function ensurePlayerInView() {
    if (!playerEl || !worldInner || !mapGridEl) return;
    const pRect = playerEl.getBoundingClientRect();
    const vRect = mapGridEl.getBoundingClientRect();
    const pad = 8;
    // horizontal
    if (pRect.right > vRect.right - pad) {
      const overflow = pRect.right - (vRect.right - pad);
      cameraX = Math.min(cameraX + overflow, Math.max(0, worldInner.clientWidth - mapGridEl.clientWidth));
      worldInner.style.transform = `translate(${-cameraX}px, ${-cameraY}px)`;
      try { updateParallax(cameraX, cameraY); } catch (e) {}
    } else if (pRect.left < vRect.left + pad) {
      const overflow = (vRect.left + pad) - pRect.left;
      cameraX = Math.max(0, cameraX - overflow);
      worldInner.style.transform = `translate(${-cameraX}px, ${-cameraY}px)`;
      try { updateParallax(cameraX, cameraY); } catch (e) {}
    }
    // vertical
    if (pRect.bottom > vRect.bottom - pad) {
      const overflow = pRect.bottom - (vRect.bottom - pad);
      cameraY = Math.min(cameraY + overflow, Math.max(0, worldInner.clientHeight - mapGridEl.clientHeight));
      worldInner.style.transform = `translate(${-cameraX}px, ${-cameraY}px)`;
      try { updateParallax(cameraX, cameraY); } catch (e) {}
    } else if (pRect.top < vRect.top + pad) {
      const overflow = (vRect.top + pad) - pRect.top;
      cameraY = Math.max(0, cameraY - overflow);
      worldInner.style.transform = `translate(${-cameraX}px, ${-cameraY}px)`;
      try { updateParallax(cameraX, cameraY); } catch (e) {}
    }
  }

  // Move player by grid delta (dx, dy)
  function movePlayer(dx, dy) {
    const idx = state.playerPosIndex;
    const x = idx % MAP_COLS;
    const y = Math.floor(idx / MAP_COLS);
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) return; // out of bounds
    const newIndex = ny * MAP_COLS + nx;
    // If target tile has a placed item, interact instead of moving
    const occupied = state.placedItems.find(p => p.index === newIndex);
    if (occupied) {
      interactWithTile(newIndex);
      return;
    }
  // update state immediately so other logic can read it
  state.playerPosIndex = newIndex;
  saveState();
  // center camera immediately (jump) so the map follows the player while they move
  try { centerCameraOn(newIndex, /*animate=*/false); } catch (e) {}
    // compute target positions
    const left = nx * TILE_W + TILE_W / 2 - 23;
    const top = ny * TILE_H + TILE_H / 2 - 23;
  // cancel any ongoing player animation
    if (_playerAnim) cancelAnimationFrame(_playerAnim);
  // play footstep / move sound
  try { sound.play('move'); } catch (e) {}
    // tween the player's left/top with two parallel tweens
    const p1 = tween({ from: parseFloat(playerEl.style.left || 0), to: left, duration: 220, onUpdate: v => playerEl.style.left = v + 'px' });
    const p2 = tween({ from: parseFloat(playerEl.style.top || 0), to: top, duration: 220, onUpdate: v => playerEl.style.top = v + 'px' });
    // stepping visual
    playerEl.classList.add('stepping');
    Promise.all([p1, p2]).then(() => {
      playerEl.classList.remove('stepping');
      // center camera after movement completes
      centerCameraOn(newIndex);
      // ensure player is visible (quick guard for edge cases)
      try { ensurePlayerInView(); } catch (e) {}
      // if player moved onto an NPC, auto-open that NPC's dialog when quest available and not yet accepted
      const npcHere = Array.isArray(state.npcs) ? state.npcs.find(n => n.index === state.playerPosIndex) : null;
      if (npcHere && npcHere.available && !npcHere.accepted) {
        showNpcDialog(npcHere.id);
      }
    });
  }

  function interactWithTile(index) {
    const placed = state.placedItems.find(p => p.index === index);
    if (!placed) return;
    // brief interaction: show message and highlight the tile
    const tile = worldInner.querySelector(`.map-tile[data-index="${index}"]`);
    statusTextEl.textContent = `This plot has ${placed.item.name}. You can't walk onto it. Use it or remove it.`;
    if (tile) {
      tile.style.transition = 'box-shadow 180ms ease';
      const old = tile.style.boxShadow;
      tile.style.boxShadow = '0 0 0 4px rgba(200,179,64,0.18)';
      setTimeout(() => { if (tile) tile.style.boxShadow = old; }, 420);
    }
  }

  // Keyboard handlers for movement (arrow keys + WASD)
  document.addEventListener('keydown', (e) => {
    // only accept movement when game screen is visible
    if (screen2.classList.contains('hidden')) return;
    const key = e.key;
    let moved = false;
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') { movePlayer(-1, 0); moved = true; }
    if (key === 'ArrowRight' || key === 'd' || key === 'D') { movePlayer(1, 0); moved = true; }
    if (key === 'ArrowUp' || key === 'w' || key === 'W') { movePlayer(0, -1); moved = true; }
    if (key === 'ArrowDown' || key === 's' || key === 'S') { movePlayer(0, 1); moved = true; }
    if (moved) e.preventDefault();
  });

  function updateInventory() {
    if (!inventoryEl) return;
    inventoryEl.innerHTML = '';
    if (state.placedItems.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No items placed yet.';
      inventoryEl.appendChild(li);
      return;
    }
    state.placedItems.forEach(p => {
      const li = document.createElement('li');
      li.textContent = `Plot ${p.index + 1}: ${p.item.name}`;
      inventoryEl.appendChild(li);
    });
  }

  function onMapTileClick(index, tileEl) {
    // Click placement uses the currently selected tool
    if (!state.selectedTool) {
      statusTextEl.textContent = 'Please select a tool from the shop first (or drag one onto the tile).';
      return;
    }
    placeItemOnTile(index, state.selectedTool, tileEl);
  }

  // Helpers for water tiles (river/stream gather)
  function isWaterTile(index) {
    const name = PLOT_NAMES[index] || '';
    const lower = name.toLowerCase();
    return /river|fisher|cove|brook|ditch|well|deepwell|stream|bank/.test(lower);
  }

  function gatherFromWater(index) {
    if (!isWaterTile(index)) return { gathered: 0, reason: 'No water source here.' };
    state.streamUses = state.streamUses || {};
    const used = state.streamUses[index] || 0;
    const MAX_USES = 3; // limited per-session uses so it's not infinite
    if (used >= MAX_USES) return { gathered: 0, reason: 'The stream looks low right now.' };
    // compute gather amount by difficulty (easy yields more)
    const mult = difficultyMultiplier();
    const base = 4; // base water gathered per scoop
    const gathered = Math.max(1, Math.round(base * mult));
    state.streamUses[index] = used + 1;
    saveState();
    return { gathered, reason: null };
  }

  // Deliver water logic
  if (deliverBtn) {
    deliverBtn.addEventListener('click', () => {
      // If player is at an NPC, handle per-NPC quest flow
      const npcHere = Array.isArray(state.npcs) ? state.npcs.find(n => n.index === state.playerPosIndex) : null;
      if (npcHere) {
        if (npcHere.available && !npcHere.accepted) {
          showNpcDialog(npcHere.id);
          return;
        }
          if (npcHere.available && npcHere.accepted) {
            const q = npcHere.quest || { type: 'deliver', target: 20, rewardCrowns: 50, rewardWater: 20 };
            const mult = difficultyMultiplier();
            const questWater = Math.max(1, Math.round((q.rewardWater || q.target || 10) * mult));
            const questCrowns = Math.max(1, Math.round((q.rewardCrowns || 40) * mult));
            state.waterDelivered += questWater;
            state.funds += questCrowns;
            // mark this NPC's quest complete
            npcHere.available = false;
            npcHere.accepted = false;
            updateHUD();
            saveState();
            renderNpc();
            statusTextEl.textContent = `Quest complete! You delivered ${questWater} aid and earned ${questCrowns} crowns (${state.difficulty}).`;
            checkAchievements();
            updateChallengeProgress('deliver', questWater);
            try { sound.play('questComplete'); } catch (e) {}
            return;
          }
      }

      // Otherwise perform a normal delivery from placed items
      let gained = 0;
      state.placedItems.forEach(p => {
        gained += (p.item.effect && p.item.effect.water) || 0;
      });
      if (gained === 0) {
        // If no placed items produced water, try gathering from a nearby stream/river at the player's location
        try {
          const gather = gatherFromWater(state.playerPosIndex);
          if (gather && gather.gathered > 0) {
            gained = gather.gathered;
            statusTextEl.textContent = `You scooped ${gained} water from ${PLOT_NAMES[state.playerPosIndex] || 'the stream'}.`;
          } else {
            // fallback small yield when nothing is available
            gained = 2;
            if (gather && gather.reason) statusTextEl.textContent = gather.reason;
          }
        } catch (e) {
          gained = 2;
        }
      }
      // apply difficulty multiplier to yields and rewards
      const mult = difficultyMultiplier();
      const gainedAdj = Math.max(1, Math.round(gained * mult));
      state.waterDelivered += gainedAdj;
      const reward = Math.floor((gainedAdj / 2) * mult);
      state.funds += reward;
      updateHUD();
      saveState();
  statusTextEl.textContent = `Delivered ${gainedAdj} supplies to the hamlet. Earned ${reward} crowns (${state.difficulty} mode).`;
      checkAchievements();
      // update challenge progress for deliver-type challenges
      updateChallengeProgress('deliver', gainedAdj);
      // possible theft on delivery (configurable)
      try {
        const theftConf = (state.config && state.config.theftChance) ? state.config.theftChance : { easy:0, normal:0.10, hard:0.25 };
        const theftChance = (typeof theftConf[state.difficulty] === 'number') ? theftConf[state.difficulty] : 0;
        if (Math.random() < theftChance) {
          const lostW = Math.min(state.waterDelivered, Math.max(1, Math.round(gainedAdj * 0.25)));
          state.waterDelivered = Math.max(0, state.waterDelivered - lostW);
          statusTextEl.textContent = `During delivery some supplies were lost (${lostW}). Be careful!`;
          saveState(); updateHUD();
        }
      } catch (e) {}
      try { sound.play('deliver'); } catch (e) {}
    });
  }

  // Achievements (simple examples)
  function checkAchievements() {
    let unlocked = false;
    if (state.waterDelivered >= 100 && !state.achievements.includes('100S')) {
      state.achievements.push('100S');
      unlocked = true;
      try { alert('Achievement unlocked: 100 supplies delivered!'); } catch (e) {}
    }
    // small placement achievement
    if (state.placedItems && state.placedItems.length >= 1 && !state.achievements.includes('PLACED1')) {
      state.achievements.push('PLACED1'); unlocked = true;
    }
    saveState();
    if (unlocked) renderAchievements();
  }

  // Screen transitions
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      // Ask for confirmation before resetting progress
      showConfirmReset().then(({ confirmed, wipe }) => {
        if (!confirmed) return;
        showLoading('Restarting...', 700).then(() => {
          resetGame(!!wipe);
          screen1.classList.add('hidden');
          screen2.classList.remove('hidden');
          try { hideLoading(); } catch (e) {}
          statusTextEl.textContent = 'Quest restarted. Player respawned.';
        });
      });
    });
  }
  // startBtn handler attached

  // Character creator wiring
  const createCharBtn = document.getElementById('createCharBtn');
  const screen3 = document.getElementById('screen-3');
  const charNameInput = document.getElementById('charName');
  const avatarListEl = document.getElementById('avatarList');
  const saveCharBtn = document.getElementById('saveCharBtn');
  const cancelCharBtn = document.getElementById('cancelCharBtn');
  let selectedAvatar = null;

  if (createCharBtn) {
    createCharBtn.addEventListener('click', () => {
      // Use the same non-blocking inline indicator when opening the creator
      showLoading('Preparing character...', 600).then(() => {
        screen1.classList.add('hidden');
        screen3.classList.remove('hidden');
        // reset form
        if (charNameInput) charNameInput.value = state.playerName || '';
        if (avatarListEl) {
          avatarListEl.querySelectorAll('.avatar-option').forEach(btn => btn.classList.remove('selected'));
          selectedAvatar = state.avatar || null;
          if (selectedAvatar) {
            // find button by emoji textContent
            const sel = Array.from(avatarListEl.querySelectorAll('.avatar-option')).find(b => b.textContent.trim() === selectedAvatar);
            if (sel) sel.classList.add('selected');
          }
        }
      });
    });
  }

  if (avatarListEl) {
    avatarListEl.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.avatar-option');
      if (!btn) return;
      avatarListEl.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      // store the emoji itself as the avatar value (easier to display later)
      selectedAvatar = btn.textContent.trim();
    });
  }

  if (cancelCharBtn) {
    cancelCharBtn.addEventListener('click', () => {
      screen3.classList.add('hidden');
      screen1.classList.remove('hidden');
    });
  }

  if (saveCharBtn) {
    saveCharBtn.addEventListener('click', () => {
      const name = charNameInput ? charNameInput.value.trim() : '';
      if (!name) {
        alert('Please enter a name for your character.');
        return;
      }
      // Use the same non-blocking indicator while saving/creating
      showLoading('Creating character...', 800).then(() => {
        state.playerName = name;
        if (selectedAvatar) state.avatar = selectedAvatar;
        saveState();
        // Update player name in HUD if present
        if (playerNameEl) playerNameEl.textContent = state.playerName;
        if (playerAvatarEl) playerAvatarEl.textContent = state.avatar || '';
        // Move to game screen
        screen3.classList.add('hidden');
        screen2.classList.remove('hidden');
        renderShop();
        renderMap();
        updateInventory();
        updateHUD();
        statusTextEl.textContent = 'Welcome, ' + state.playerName + '! Select an item from the shop.';
        // play a friendly chime when character is created
        try { sound.play('place'); } catch (e) {}
      });
    });
  }

  loadBtn.addEventListener('click', () => {
  // loadBtn clicked
    // Show loading overlay and wait for the fill+finish to complete before hiding
  showLoading('Loading saved game...', 1000).then(() => {
  // showLoading resolved for loadBtn
      screen1.classList.add('hidden');
      screen2.classList.remove('hidden');
      renderShop();
      renderMap();
      updateInventory();
      updateHUD();
      statusTextEl.textContent = 'Loaded saved game state.';
      hideLoading();
    });
  });
  // loadBtn handler attached

  // Demo load removed per user request

  backBtn.addEventListener('click', () => {
    // Return to main screen
    screen2.classList.add('hidden');
    screen1.classList.remove('hidden');
    statusTextEl.textContent = 'Returned to the main menu.';
  });
  // backBtn handler attached

  // Restart button in the mission panel should also reset progress and respawn
  const startMissionBtn = document.getElementById('startMission');
  if (startMissionBtn) {
    startMissionBtn.addEventListener('click', () => {
      showConfirmReset().then(({ confirmed, wipe }) => {
        if (!confirmed) return;
        showLoading('Restarting...', 600).then(() => {
          resetGame(!!wipe);
          // ensure we are showing the game screen
          screen1.classList.add('hidden');
          screen2.classList.remove('hidden');
          try { hideLoading(); } catch (e) {}
          statusTextEl.textContent = 'Quest restarted. Player respawned.';
          try { sound.play('deliver'); } catch (e) {}
        });
      });
    });
  }

  // Help button exists in markup; attach listener if present
  const helpBtn = document.getElementById('helpBtn');
  // Sound controls UI
  const soundToggleBtn = document.getElementById('soundToggle');
  const soundVolumeEl = document.getElementById('soundVolume');
  const enableSoundBtn = document.getElementById('enableSoundBtn');
  const musicToggleBtn = document.getElementById('musicToggleBtn');
  // initialize UI from saved settings
  try {
    if (soundVolumeEl) soundVolumeEl.value = String(sound.volume);
    if (soundToggleBtn) {
      soundToggleBtn.setAttribute('aria-pressed', String(sound.muted ? 'true' : 'false'));
      soundToggleBtn.textContent = sound.muted ? '🔈' : '🔊';
    }
  } catch (e) {}

  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
      // resume AudioContext on first gesture
      try { if (sound.ctx && sound.ctx.state === 'suspended') sound.ctx.resume(); } catch (e) {}
      const willMute = !sound.muted;
      sound.setMuted(willMute);
      soundToggleBtn.setAttribute('aria-pressed', String(sound.muted));
      soundToggleBtn.textContent = sound.muted ? '🔈' : '🔊';
      // Initialize YouTube player on first unmute and start music playback
      if (!willMute) {
        // ensure we have a player and play a shuffled track
        createYtPlayer().then(() => {
          try {
            // set volume on player
            if (ytPlayer && typeof ytPlayer.setVolume === 'function') ytPlayer.setVolume(Math.round(sound.volume * 100));
            // if player is not already playing, start a random track
            try { playNextYt(); } catch (e) {}
          } catch (e) {}
        }).catch(() => {});
      } else {
        // if muted, pause music playback to respect user's mute choice
        try { if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') ytPlayer.pauseVideo(); } catch (e) {}
      }
    });
  }
  // Enable sound explicit CTA (helps resume AudioContext on restrictive browsers)
  if (enableSoundBtn) {
    enableSoundBtn.addEventListener('click', () => {
      try { sound.init(); } catch (e) {}
      try { if (sound.ctx && sound.ctx.state === 'suspended') sound.ctx.resume(); } catch (e) {}
      // unmute SFX by default when user explicitly enables sound
      try { sound.setMuted(false); } catch (e) {}
      try { if (soundToggleBtn) { soundToggleBtn.setAttribute('aria-pressed', String(sound.muted)); soundToggleBtn.textContent = sound.muted ? '🔈' : '🔊'; } } catch (e) {}
      // create YT player but don't auto-play until user hits music toggle
      // Play a tiny fallback audio to ensure browser unlocks audio on this user gesture
      try { if (sound.audioFallback) { sound.audioFallback.currentTime = 0; sound.audioFallback.play().catch(()=>{}); } } catch (e) {}
      try { sound.play('place'); } catch (e) {}
      createYtPlayer().then(() => {
        enableSoundBtn.classList.add('hidden');
        try { enableSoundBtn.setAttribute('aria-hidden', 'true'); } catch (e) {}
      }).catch(() => { enableSoundBtn.classList.add('hidden'); });
    });
  }
  // Music play/pause (medieval labels)
  let musicPlaying = false;
  if (musicToggleBtn) {
    musicToggleBtn.addEventListener('click', () => {
      // ensure player exists and AudioContext is resumed
      try { sound.init(); if (sound.ctx && sound.ctx.state === 'suspended') sound.ctx.resume(); } catch (e) {}
      createYtPlayer().then(() => {
        try {
          const playerState = (ytPlayer && typeof ytPlayer.getPlayerState === 'function') ? ytPlayer.getPlayerState() : null;
          if (typeof YT !== 'undefined' && playerState === YT.PlayerState.PLAYING) {
            // pause
            try { ytPlayer.pauseVideo(); } catch (e) {}
            musicPlaying = false;
            musicToggleBtn.textContent = 'Let Music Play';
          } else {
            // start playing (use playNextYt to choose track)
            try { playNextYt(); } catch (e) { try { ytPlayer.playVideo(); } catch (e) {} }
            musicPlaying = true;
            musicToggleBtn.textContent = 'Still the Minstrels';
          }
        } catch (e) {
          // fallback: try play/pause methods
          try { if (ytPlayer && typeof ytPlayer.playVideo === 'function') { playNextYt(); musicPlaying = true; musicToggleBtn.textContent = 'Still the Minstrels'; } } catch (err) {}
        }
      }).catch(() => {});
    });
  }
  if (soundVolumeEl) {
    soundVolumeEl.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      sound.setVolume(v);
      try { if (ytPlayer && typeof ytPlayer.setVolume === 'function') ytPlayer.setVolume(Math.round(v * 100)); } catch (e) {}
    });
  }
  if (helpBtn) {
    helpBtn.addEventListener('click', () => {
      alert('Help:\n1) Select an item from the shop or drag it onto a plot.\n2) Click a plot on the map to place it.\n3) Press Deliver Supplies to deliver resources and earn money.\n\nConfiguration: Open the Configuration panel on the right (under Challenges) to tune enemy density and theft chance for deliveries. Changes apply immediately for this session.\n\nAchievements: Click the trophy button in the header (🏆) to view achievements. Challenges rotate each session and are visible in the Challenges panel.');
    });
  }
  // --- New UI: Difficulty select, Achievements, and Challenges wiring
  const difficultySelect = document.getElementById('difficultySelect');
  const achievementsBtn = document.getElementById('achievementsBtn');
  const achievementsDialog = document.getElementById('achievementsDialog');
  const achievementsListEl = document.getElementById('achievementsList');
  const closeAchievementsBtn = document.getElementById('closeAchievementsBtn');
  const clearAchievementsBtn = document.getElementById('clearAchievementsBtn');
  const challengesListEl = document.getElementById('challengesList');

  // shared opener for achievements dialog (defensive event stops included)
  function openAchievements(ev) {
    try {
      if (ev) {
        ev.preventDefault && ev.preventDefault();
        ev.stopImmediatePropagation && ev.stopImmediatePropagation();
        ev.stopPropagation && ev.stopPropagation();
      }
      console.log('openAchievements invoked');
    } catch (e) {}
    renderAchievements();
    if (achievementsDialog) { achievementsDialog.classList.remove('hidden'); achievementsDialog.setAttribute('aria-hidden','false'); }
  }

  function renderChallenges() {
    if (!challengesListEl) return;
    challengesListEl.innerHTML = '';
    // ensure we have a seeded session set
    seedSessionChallenges();
    const list = Array.isArray(state.sessionChallenges) && state.sessionChallenges.length ? state.sessionChallenges : CHALLENGE_POOL;
    list.forEach(ch => {
      const div = document.createElement('div');
      div.className = 'challenge';
      const progress = state.challengeProgress[ch.id] || 0;
      const isActive = state.activeChallenge && state.activeChallenge.id === ch.id;
      div.innerHTML = `<div class="meta"><strong>${ch.title}</strong><div style="font-size:0.85rem;color:#6b7280;">${ch.desc}</div></div>`;
      const right = document.createElement('div');
      if (isActive) {
        right.innerHTML = `<div style="font-size:0.9rem;color:#0f5132;">${progress}/${ch.target}</div>`;
        const btn = document.createElement('button'); btn.className='btn'; btn.textContent='Abandon'; btn.addEventListener('click', ()=>{ state.activeChallenge = null; saveState(); renderChallenges(); statusTextEl.textContent='Challenge abandoned.'; });
        right.appendChild(btn);
      } else {
        const btn = document.createElement('button'); btn.className='btn primary accept'; btn.textContent='Accept'; btn.addEventListener('click', ()=>{ state.activeChallenge = ch; state.challengeProgress[ch.id]=0; saveState(); renderChallenges(); statusTextEl.textContent=`Challenge accepted: ${ch.title}`; });
        right.appendChild(btn);
      }
      div.appendChild(right);
      challengesListEl.appendChild(div);
    });
  }

  function updateChallengeProgress(type, amount = 1, meta = {}) {
    if (!state.activeChallenge) return;
    const ch = state.activeChallenge;
    if (ch.type !== type) return;
    const cur = state.challengeProgress[ch.id] || 0;
    const next = cur + amount;
    state.challengeProgress[ch.id] = next;
    if (next >= ch.target) {
      // complete challenge
      // award and clear active
      state.activeChallenge = null;
      state.funds += ch.rewardGold || 10;
      statusTextEl.textContent = `Challenge complete: ${ch.title}. Reward: ${ch.rewardGold || 10} crowns`;
      // rotate this completed challenge out of the session set so players see a new one
      rotateSessionChallenge(ch.id);
      saveState();
      renderChallenges();
      checkAchievements();
      try { sound.play('questComplete'); } catch (e) {}
      return;
    }
    saveState();
    renderChallenges();
  }

  // Remove a completed challenge from the current session list and replace it
  function rotateSessionChallenge(completedId) {
    if (!Array.isArray(state.sessionChallenges) || state.sessionChallenges.length === 0) return;
    // remove any entries matching the completed id
    state.sessionChallenges = state.sessionChallenges.filter(c => c.id !== completedId);
    // choose a replacement from the pool (not already in session)
    const existing = new Set(state.sessionChallenges.map(c => c.id));
    const candidates = CHALLENGE_POOL.filter(c => !existing.has(c.id) && c.id !== completedId);
    if (candidates.length === 0) return; // nothing to add
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    state.sessionChallenges.push(pick);
  }

  function renderAchievements() {
    if (!achievementsListEl) return;
    achievementsListEl.innerHTML = '';
    if (!state.achievements || state.achievements.length === 0) {
      achievementsListEl.innerHTML = '<div class="small">No achievements yet. Keep playing!</div>';
      return;
    }
    state.achievements.forEach(code => {
      const def = ACHIEVEMENT_DEFS[code] || { name: code, desc: '' };
      const el = document.createElement('div'); el.className = 'achievement';
      el.innerHTML = `<div><strong>${def.name}</strong><div style="font-size:0.85rem;color:#6b7280;">${def.desc}</div></div><div style="font-weight:700;color:#0f5132;">Unlocked</div>`;
      achievementsListEl.appendChild(el);
    });
  }

  if (difficultySelect) {
    difficultySelect.value = state.difficulty || 'normal';
    difficultySelect.addEventListener('change', (e) => { state.difficulty = e.target.value || 'normal'; saveState(); statusTextEl.textContent = `Difficulty set to ${state.difficulty}`; });
  }
  if (achievementsBtn) {
    achievementsBtn.addEventListener('click', openAchievements);
  }

  // Configuration UI wiring
  const enemyDensitySelect = document.getElementById('enemyDensity');
  const theftChanceSlider = document.getElementById('theftChanceSlider');
  const resetConfigBtn = document.getElementById('resetConfigBtn');
  function applyConfigUI() {
    if (enemyDensitySelect) enemyDensitySelect.value = state.config && state.config.enemyDensity ? state.config.enemyDensity : 'auto';
    if (theftChanceSlider && state.config && state.config.theftChance) {
      const val = Math.round((state.config.theftChance.normal || 0) * 100);
      theftChanceSlider.value = String(val);
    }
  }
  applyConfigUI();
  if (enemyDensitySelect) {
    enemyDensitySelect.addEventListener('change', (e) => {
      state.config = state.config || {};
      state.config.enemyDensity = e.target.value;
      // force respawn of enemies on next render
      state.enemyTiles = [];
      saveState(); renderMap();
    });
  }
  if (theftChanceSlider) {
    theftChanceSlider.addEventListener('input', (e) => {
      const v = Number(e.target.value) / 100;
      state.config = state.config || {};
      state.config.theftChance = { easy: 0, normal: v, hard: Math.min(0.95, v * 2) };
      saveState();
    });
  }
  if (resetConfigBtn) {
    resetConfigBtn.addEventListener('click', () => {
      state.config = { enemyCounts: { easy: 0, normal: 2, hard: 4 }, enemyDensity: 'auto', theftChance: { easy: 0, normal: 0.10, hard: 0.25 } };
      state.enemyTiles = [];
      applyConfigUI(); saveState(); renderMap(); statusTextEl.textContent = 'Configuration reset to defaults.';
    });
  }

  // First-person view removed for production build. map rendering uses the default renderMap behavior.
  

  // keyboard shortcut: press 'A' to open achievements when on the game screen
  document.addEventListener('keydown', (ev) => {
    if (ev.key && (ev.key === 'a' || ev.key === 'A')) {
      // only open when game screen is visible
      if (screen2 && screen2.classList.contains('hidden')) return;
      renderAchievements();
      if (achievementsDialog) { achievementsDialog.classList.remove('hidden'); achievementsDialog.setAttribute('aria-hidden','false'); }
    }
  });
  if (closeAchievementsBtn) {
    closeAchievementsBtn.addEventListener('click', () => { if (achievementsDialog) { achievementsDialog.classList.add('hidden'); achievementsDialog.setAttribute('aria-hidden','true'); } });
  }
  if (clearAchievementsBtn) {
    clearAchievementsBtn.addEventListener('click', () => { state.achievements = []; saveState(); renderAchievements(); statusTextEl.textContent = 'Achievements cleared.'; });
  }

  // initial render of challenges and achievements UI
  renderChallenges();
  renderAchievements();
  // helpBtn handler attached

  // If the user previously had screen2 open (persisted), show it directly
  if (state.placedItems && state.placedItems.length > 0) {
    // Show loading overlay while restoring
  showLoading('Restoring saved game...', 1000).then(() => {
      // Start in screen2 so players return to their placed items quickly
      screen1.classList.add('hidden');
      screen2.classList.remove('hidden');
      renderShop();
      renderMap();
      updateInventory();
      updateHUD();
      hideLoading();
    });
  }
});
// Log a message to the console to ensure the script is linked correctly
console.log('JavaScript file is linked correctly.');
      hideLoading();
    
// Log a message to the console to ensure the script is linked correctly
console.log('JavaScript file is linked correctly.');
