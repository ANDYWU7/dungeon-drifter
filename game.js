(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('game-canvas');
  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  const WORLD_W = 69;
  const WORLD_H = 45;
  const VIEW_W = 18;
  const VIEW_H = 12;
  const ZOOM = 1.35;
  const VISIBILITY_DISTANCE = 14.5;
  const VISIBILITY_SAMPLES = 7;
  const FLOOR_VISIBILITY_GRID = 12;
  const RAY_EPSILON = 0.00001;
  // Keep the player and the immediately surrounding floor free of sub-cell
  // shadow wedges. Farther cells still use the full raycast mask.
  const PLAYER_LIGHT_RADIUS = 1.45;
  const PLAYER_CELL_RADIUS = 1;
  const TERRAIN_SHADOW = 'rgba(0,0,0,.78)';
  const WALL_SHADOW = 'rgba(0,0,0,.18)';
  const VOID_COLOR = '#000000';
  const KING_DETECT_RANGE = 4;
  const KING_SLASH_RANGE = 2;
  const KING_SLASH_ARC = Math.PI / 2;
  const KING_WINDUP = .4;
  const KING_COOLDOWN = 2.5;
  const KING_HEAL_INTERVAL = 5;
  const KING_HEAL_AMOUNT = 35;
  const FLOOR_THEMES = [
    { name: 'CAVES', palette: { void: VOID_COLOR, floor: '#686a69', floorAlt: '#737573', wall: '#2a2d2f', wallTop: '#2a2d2f', grout: '#202225', player: '#ccd1c8', playerLight: '#f0eee4', enemy: '#80726a', boss: '#596665', bossLight: '#9ca99d', chest: '#ab8c55', accent: '#c0a86c' } },
    { name: 'DUNGEON', palette: { void: VOID_COLOR, floor: '#414342', floorAlt: '#4b4d4b', wall: '#2f221e', wallTop: '#2f221e', grout: '#241a17', player: '#c4cbc3', playerLight: '#f1ead7', enemy: '#7d695a', boss: '#5e4540', bossLight: '#b28c69', chest: '#a67c48', accent: '#b7a270' } },
    { name: 'CASTLE', palette: { void: VOID_COLOR, floor: '#675244', floorAlt: '#745d4c', wall: '#505256', wallTop: '#505256', grout: '#393b3f', player: '#cbd2ca', playerLight: '#f4ead6', enemy: '#967057', boss: '#5d4646', bossLight: '#bd9570', chest: '#be9659', accent: '#c9ae78' } }
  ];
  const FLOOR_PROFILES = [
    { light: { kind: 'bat', name: 'BAT', hp: 20, damage: 10, goldMin: 5, goldMax: 15 }, heavy: { kind: 'skeleton', name: 'SKELETON', hp: 40, damage: 20, goldMin: 20, goldMax: 30 }, boss: { kind: 'giant-slime', name: 'GIANT SLIME', hp: 250, damage: 40, goldMin: 250, goldMax: 250 } },
    { light: { kind: 'zombie', name: 'ZOMBIE', hp: 45, damage: 25, goldMin: 5, goldMax: 15 }, heavy: { kind: 'prisoner', name: 'PRISONER', hp: 60, damage: 30, goldMin: 20, goldMax: 30 }, boss: { kind: 'warden', name: 'WARDEN', hp: 400, damage: 45, goldMin: 250, goldMax: 250 } },
    { light: { kind: 'peasant', name: 'PEASANT', hp: 50, damage: 25, goldMin: 5, goldMax: 15 }, heavy: { kind: 'knight', name: 'KNIGHT', hp: 75, damage: 35, goldMin: 20, goldMax: 30 }, boss: { kind: 'king', name: 'KING', hp: 750, damage: 60, goldMin: 250, goldMax: 250 } }
  ];
  const ITEM_TIERS = {
    common: [{ name: 'WOOD BAT', slot: 'weapon', damage: 15 }, { name: 'LEATHER TUNIC', slot: 'chest', armor: 15 }, { name: 'LEATHER PANTS', slot: 'legs', armor: 10 }, { name: 'LEATHER CAP', slot: 'helmet', armor: 5 }],
    uncommon: [{ name: 'BRONZE SWORD', slot: 'weapon', damage: 20 }, { name: 'CHAIN CHESTPLATE', slot: 'chest', armor: 30 }, { name: 'BRONZE LEGGINGS', slot: 'legs', armor: 20 }, { name: 'BRONZE HELMET', slot: 'helmet', armor: 10 }],
    rare: [{ name: 'STEEL SWORD', slot: 'weapon', damage: 30 }, { name: 'STEEL CHESTPLATE', slot: 'chest', armor: 50 }, { name: 'STEEL LEGGINGS', slot: 'legs', armor: 25 }, { name: 'STEEL HELMET', slot: 'helmet', armor: 15 }]
  };
  const TIER_CHANCES = [{ common: .9, uncommon: .1, rare: 0 }, { common: .35, uncommon: .6, rare: .05 }, { common: .1, uncommon: .2, rare: .7 }];
  const settingsKey = 'dungeon-drifter-settings';
  const storedSettings = (() => { try { return JSON.parse(localStorage.getItem(settingsKey) || '{}'); } catch { return {}; } })();
  const settings = { volume: storedSettings.volume ?? 70, shake: storedSettings.shake ?? true, flashes: storedSettings.flashes ?? true, holdSprint: storedSettings.holdSprint ?? true };
  const bestGoldKey = 'dungeon-drifter-best-gold';
  let recordStorageAvailable = true;
  let bestGold = (() => {
    try { const value = Number(localStorage.getItem(bestGoldKey)); return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
    catch { recordStorageAvailable = false; return 0; }
  })();
  const input = { keys: new Set(), joystick: { active: false, x: 0, y: 0 }, sprint: false };
  const game = { running: false, paused: false, runSeed: 0, last: 0, floor: 1, theme: FLOOR_THEMES[0], profile: FLOOR_PROFILES[0], map: [], mapWidth: WORLD_W, mapHeight: WORLD_H, player: null, bossPosition: null, enemies: [], chests: [], particles: [], visibleCells: new Set(), inventory: { weapon: null, armor: { chest: null, legs: null, helmet: null } }, slash: 0, shake: 0, flash: 0, elapsed: 0, gold: 0, toastTimer: 0, bossAlerted: false, bossDefeated: false, bossFamilyActive: false, floorAdvanceQueued: false, audio: null };
  let audioContext;
  let animationFrame = 0;

  function saveSettings() { try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch { /* private mode */ } }
  function showScreen(id) { document.querySelectorAll('.screen').forEach((node) => node.classList.add('hidden')); $(id).classList.remove('hidden'); }
  function formatTime(seconds) { const m = Math.floor(seconds / 60).toString().padStart(2, '0'); const s = Math.floor(seconds % 60).toString().padStart(2, '0'); return `${m}:${s}`; }

  function initSettingsUi() {
    $('volume-slider').value = settings.volume;
    $('volume-value').textContent = `${settings.volume}%`;
    setToggle($('shake-toggle'), settings.shake);
    setToggle($('flash-toggle'), settings.flashes);
    setToggle($('hold-sprint-toggle'), settings.holdSprint);
  }
  function setToggle(node, on) { node.classList.toggle('is-on', on); node.setAttribute('aria-checked', String(on)); node.querySelector('b').textContent = on ? 'ON' : 'OFF'; }
  function setSprint(active) { input.sprint = active; $('sprint-button').classList.toggle('is-active', active); }
  function pressSprint() { if (settings.holdSprint) setSprint(true); else setSprint(!input.sprint); }
  function releaseSprint() { if (settings.holdSprint) setSprint(false); }
  function resetSprint() { setSprint(false); }
  function resetInput() {
    resetSprint(); input.keys.clear();
    input.joystick.active = false; input.joystick.x = 0; input.joystick.y = 0;
    $('joystick-knob').style.transform = 'translate(0, 0)';
  }
  function stopLoop() { cancelAnimationFrame(animationFrame); animationFrame = 0; }
  function setupUi() {
    initSettingsUi();
    $('menu-best-gold').textContent = bestGold;
    $('menu-record-scope').textContent = recordStorageAvailable ? 'On this device' : 'This session';
    $('play-button').addEventListener('click', startGame);
    $('settings-button').addEventListener('click', () => { initSettingsUi(); showScreen('settings-screen'); });
    $('close-settings').addEventListener('click', () => showScreen('menu-screen'));
    $('volume-slider').addEventListener('input', (e) => { settings.volume = Number(e.target.value); $('volume-value').textContent = `${settings.volume}%`; saveSettings(); });
    $('shake-toggle').addEventListener('click', () => { settings.shake = !settings.shake; setToggle($('shake-toggle'), settings.shake); saveSettings(); });
    $('flash-toggle').addEventListener('click', () => { settings.flashes = !settings.flashes; setToggle($('flash-toggle'), settings.flashes); saveSettings(); });
    $('hold-sprint-toggle').addEventListener('click', () => { settings.holdSprint = !settings.holdSprint; setToggle($('hold-sprint-toggle'), settings.holdSprint); resetSprint(); saveSettings(); });
    $('pause-button').addEventListener('click', pauseGame);
    $('restart-button').addEventListener('click', startGame);
    $('resume-button').addEventListener('click', resumeGame);
    $('pause-menu-button').addEventListener('click', returnToMenu);
    $('replay-button').addEventListener('click', startGame);
    $('result-menu-button').addEventListener('click', returnToMenu);
    $('attack-button').addEventListener('pointerdown', (e) => { e.preventDefault(); attack(); });
    $('dash-button').addEventListener('pointerdown', (e) => { e.preventDefault(); dash(); });
    $('potion-button').addEventListener('pointerdown', (e) => { e.preventDefault(); usePotion(); });
    $('sprint-button').addEventListener('pointerdown', (e) => { e.preventDefault(); $('sprint-button').setPointerCapture(e.pointerId); pressSprint(); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((eventName) => $('sprint-button').addEventListener(eventName, releaseSprint));
    setupJoystick();
    window.addEventListener('keydown', (e) => {
      if (!game.running || game.paused) return;
      const key = e.key.toLowerCase();
      if ((key === 'n' || key === 'm') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!e.repeat) jumpToFloor(key === 'n' ? 2 : 3, key === 'n' ? 'common' : 'uncommon');
        return;
      }
      input.keys.add(key);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) || e.code === 'ShiftLeft') e.preventDefault();
      if (e.code === 'ShiftLeft' && !e.repeat) pressSprint();
      if (!e.repeat && key === 'q') dash();
      if (!e.repeat && key === 'e') usePotion();
      if (key === ' ') attack();
    }, true);
    window.addEventListener('keyup', (e) => { const key = e.key.toLowerCase(); input.keys.delete(key); if (e.code === 'ShiftLeft') releaseSprint(); }, true);
    window.addEventListener('blur', resetInput);
    document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
    window.addEventListener('resize', resizeCanvas);
  }
  function setupJoystick() {
    const stick = $('joystick');
    const knob = $('joystick-knob');
    const update = (event) => {
      const rect = stick.getBoundingClientRect();
      const cx = rect.left + 67.5;
      const cy = rect.bottom - 67.5;
      const max = 42;
      let dx = event.clientX - cx; let dy = event.clientY - cy;
      const length = Math.hypot(dx, dy); if (length > max) { dx = (dx / length) * max; dy = (dy / length) * max; }
      input.joystick.x = dx / max; input.joystick.y = dy / max; knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { e.preventDefault(); input.joystick.active = true; stick.setPointerCapture(e.pointerId); update(e); });
    stick.addEventListener('pointermove', (e) => { if (input.joystick.active) update(e); });
    const release = () => { input.joystick.active = false; input.joystick.x = 0; input.joystick.y = 0; knob.style.transform = 'translate(0, 0)'; };
    stick.addEventListener('pointerup', release); stick.addEventListener('pointercancel', release); stick.addEventListener('lostpointercapture', release);
  }

  function startGame() {
    ensureAudio();
    stopLoop(); resetInput();
    game.summary = { gear: new Map(), enemies: new Map(), clearedFloors: new Set(), furthestFloor: 1 };
    game.running = true; game.paused = false; game.runSeed = Math.floor(Math.random() * 4294967296) >>> 0; game.floor = 1; game.gold = 0; game.inventory = { weapon: null, armor: { chest: null, legs: null, helmet: null } }; game.player = null; game.elapsed = 0; game.last = performance.now(); game.shake = 0; game.flash = 0;
    beginFloor(1); showScreen('game-screen'); resizeCanvas(); toast('The dungeon is ready.'); animationFrame = requestAnimationFrame(loop); tone(220, .08, 'sine');
  }
  function pauseGame() { if (!game.running || game.paused) return; game.paused = true; stopLoop(); resetInput(); showScreen('pause-screen'); }
  function resumeGame() { if (!game.running || !game.paused) return; game.paused = false; game.last = performance.now(); showScreen('game-screen'); animationFrame = requestAnimationFrame(loop); }
  function returnToMenu() { if (game.running) { endRun(false, 'You ended the run'); return; } showScreen('menu-screen'); }
  function jumpToFloor(floor, tier) {
    if (!game.running || game.paused) return;
    resetInput();
    game.inventory = { weapon: null, armor: { chest: null, legs: null, helmet: null } };
    ITEM_TIERS[tier].forEach((item) => {
      const equipped = { ...item, tier };
      collectGear(equipped);
      if (item.slot === 'weapon') game.inventory.weapon = equipped;
      else game.inventory.armor[item.slot] = equipped;
    });
    beginFloor(floor);
    toast(`Testing: ${game.theme.name.toLowerCase()} with full ${tier} gear.`);
  }
  function seededRandom(seed) { let value = seed >>> 0; return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function generateMap(floor) {
    const random = seededRandom((game.runSeed + floor * 1777) >>> 0);
    const grid = Array.from({ length: WORLD_H }, () => Array(WORLD_W).fill('#'));
    const rooms = [];
    const startRoom = { x: 2, y: WORLD_H - 8, w: 9, h: 6 };
    const bossRoom = { x: Math.floor(WORLD_W / 2) - 5, y: Math.floor(WORLD_H / 2) - 4, w: 11, h: 9 };
    const overlaps = (a, b) => a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x && a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y;
    const carve = (room) => { for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) if (x > 0 && y > 0 && x < WORLD_W - 1 && y < WORLD_H - 1) grid[y][x] = '.'; };
    const hallwayRadius = 1; // radius 1 makes every hallway three blocks wide
    const brush = (x, y, radius = hallwayRadius) => { for (let yy = y - radius; yy <= y + radius; yy++) for (let xx = x - radius; xx <= x + radius; xx++) if (xx > 0 && yy > 0 && xx < WORLD_W - 1 && yy < WORLD_H - 1) grid[yy][xx] = '.'; };
    const center = (room) => ({ x: Math.floor(room.x + room.w / 2), y: Math.floor(room.y + room.h / 2) });
    const tunnel = (from, to) => { let x = from.x, y = from.y; const horizontalFirst = random() > .35; const stepX = x < to.x ? 1 : -1; const stepY = y < to.y ? 1 : -1; const walkX = () => { while (x !== to.x) { brush(x, y, 1); x += stepX; } }; const walkY = () => { while (y !== to.y) { brush(x, y, 1); y += stepY; } }; if (horizontalFirst) { walkX(); walkY(); } else { walkY(); walkX(); } brush(to.x, to.y, 1); };
    rooms.push(startRoom, bossRoom); carve(startRoom); carve(bossRoom);
    const roomCount = 8 + floor * 2 + Math.floor(random() * 3);
    for (let i = 0; i < roomCount; i++) {
      const room = { x: 2 + Math.floor(random() * (WORLD_W - 11)), y: 2 + Math.floor(random() * (WORLD_H - 9)), w: 4 + Math.floor(random() * 4), h: 4 + Math.floor(random() * 3) };
      if (rooms.some((existing) => overlaps(room, existing))) continue;
      rooms.push(room); carve(room);
    }
    const route = [startRoom, ...rooms.slice(2), bossRoom];
    for (let i = 1; i < route.length; i++) tunnel(center(route[i - 1]), center(route[i]));
    const sideRooms = route.slice(1, -1); for (let i = 0; i < Math.floor(sideRooms.length / 2); i++) { const a = sideRooms[Math.floor(random() * sideRooms.length)]; const b = sideRooms[Math.floor(random() * sideRooms.length)]; tunnel(center(a), center(b)); }
    // Only the outline around walkable tiles is wall. Unused space is void.
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
      if (grid[y][x] !== '#') continue;
      let bordersFloor = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (grid[y + dy]?.[x + dx] === '.') bordersFloor = true;
      }
      if (!bordersFloor) grid[y][x] = ' ';
    }
    const start = { x: startRoom.x + 2, y: startRoom.y + 2 };
    const boss = center(bossRoom);
    const cellKey = (x, y) => `${x},${y}`;
    const reserved = new Set([cellKey(start.x, start.y), cellKey(boss.x, boss.y)]);
    const floorCells = [];
    for (let y = 2; y < WORLD_H - 2; y++) for (let x = 2; x < WORLD_W - 2; x++) if (grid[y][x] === '.' && Math.hypot(x - start.x, y - start.y) > 4 && Math.hypot(x - boss.x, y - boss.y) > 4) floorCells.push({ x, y });
    const takeCell = (minFromStart = 0) => { for (let tries = 0; tries < 80; tries++) { const pick = floorCells[Math.floor(random() * floorCells.length)]; if (!pick) continue; const key = cellKey(pick.x, pick.y); if (!reserved.has(key) && Math.hypot(pick.x - start.x, pick.y - start.y) >= minFromStart) { reserved.add(key); return pick; } } return floorCells.find((pick) => !reserved.has(cellKey(pick.x, pick.y))) || { x: start.x + 1, y: start.y }; };
    const chestCount = 5 + floor;
    const chests = Array.from({ length: chestCount }, () => { const cell = takeCell(7); return { x: cell.x + .5, y: cell.y + .5, open: false, id: `${floor}-${cell.x}-${cell.y}` }; });
    const enemyCount = 5 + floor * 2;
    const spawns = Array.from({ length: enemyCount }, (_, index) => { const cell = takeCell(8); return { x: cell.x + .5, y: cell.y + .5, role: index % 4 === 0 ? 'heavy' : 'light' }; });
    return { grid, start, boss, chests, spawns };
  }
  function beginFloor(floor) {
    game.summary.furthestFloor = Math.max(game.summary.furthestFloor, floor);
    game.floor = floor; game.theme = FLOOR_THEMES[floor - 1]; game.profile = FLOOR_PROFILES[floor - 1]; const generated = generateMap(floor); game.map = generated.grid; game.mapWidth = WORLD_W; game.mapHeight = WORLD_H; game.bossPosition = { x: generated.boss.x + .5, y: generated.boss.y + .5 };
    const previousPotions = game.player?.potions ?? 2; const maxHp = 100 + armorBonus();
    game.player = { x: generated.start.x + .5, y: generated.start.y + .5, hp: maxHp, maxHp, stamina: 100, maxStamina: 100, sprintExhausted: false, facingX: 1, facingY: 0, potions: previousPotions, weapon: game.inventory.weapon, invincible: 0, dashTime: 0, dashX: 0, dashY: 0, attackCooldown: 0 };
    game.enemies = generated.spawns.map((spawn, i) => createEnemy(spawn.role === 'heavy' ? game.profile.heavy : game.profile.light, spawn.x, spawn.y, { id: `enemy-${floor}-${i}` }));
    game.enemies.push(createEnemy(game.profile.boss, game.bossPosition.x, game.bossPosition.y, { id: `boss-${floor}`, boss: true, bossFamily: true, summonTimer: 10 + Math.random() * 5 }));
    game.chests = generated.chests;
    game.particles = []; game.visibleCells.clear(); game.slash = 0; game.bossAlerted = false; game.bossDefeated = false; game.bossFamilyActive = false; game.floorAdvanceQueued = false; game.floorAdvanceDelay = 0;
    $('floor-name').textContent = game.theme.name; $('floor-number').textContent = String(floor).padStart(2, '0'); $('objective-text').textContent = `Defeat the ${game.profile.boss.name.toLowerCase()} to continue.`; $('boss-alert').classList.add('hidden'); updateHud();
  }
  function armorBonus() { return Object.values(game.inventory.armor).reduce((total, item) => total + (item?.armor || 0), 0); }
  function createEnemy(profile, x, y, extra = {}) { return { ...profile, ...extra, x, y, hp: profile.hp, maxHp: profile.hp, attackCooldown: profile.kind === 'king' ? 0 : Math.random() * 1.2, healTimer: profile.kind === 'king' ? KING_HEAL_INTERVAL : 0, kingWindup: 0, slash: 0, summonTimer: profile.kind === 'warden' ? 0 : extra.summonTimer, initialGuardsSpawned: false, facingX: 1, facingY: 0, hitFlash: 0, phase: Math.random() * TAU }; }
  function resizeCanvas() { const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.max(1, Math.floor(rect.width * dpr)); canvas.height = Math.max(1, Math.floor(rect.height * dpr)); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function screenSize() { const rect = canvas.getBoundingClientRect(); return { w: rect.width, h: rect.height }; }
  function tileMetrics() { const { w, h } = screenSize(); const tile = Math.min(w / VIEW_W, h / VIEW_H) * ZOOM; const cameraX = game.player?.x ?? WORLD_W / 2; const cameraY = game.player?.y ?? WORLD_H / 2; return { tile, ox: w / 2 - cameraX * tile, oy: h / 2 - cameraY * tile }; }
  function worldToScreen(x, y) { const { tile, ox, oy } = tileMetrics(); return { x: ox + x * tile, y: oy + y * tile, tile }; }
  function isWall(x, y) { const tx = Math.floor(x), ty = Math.floor(y); return tx < 0 || ty < 0 || tx >= game.mapWidth || ty >= game.mapHeight || game.map[ty]?.[tx] !== '.'; }
  function canMove(x, y, radius = .22) { return !isWall(x - radius, y - radius) && !isWall(x + radius, y - radius) && !isWall(x - radius, y + radius) && !isWall(x + radius, y + radius); }
  function tryMove(entity, dx, dy, radius = .23) { const nx = entity.x + dx; if (canMove(nx, entity.y, radius)) entity.x = nx; const ny = entity.y + dy; if (canMove(entity.x, ny, radius)) entity.y = ny; }
  function direction() {
    let x = input.joystick.x; let y = input.joystick.y;
    if (!input.joystick.active) { x = (input.keys.has('d') || input.keys.has('arrowright') ? 1 : 0) - (input.keys.has('a') || input.keys.has('arrowleft') ? 1 : 0); y = (input.keys.has('s') || input.keys.has('arrowdown') ? 1 : 0) - (input.keys.has('w') || input.keys.has('arrowup') ? 1 : 0); }
    const mag = Math.hypot(x, y); return mag > 1 ? { x: x / mag, y: y / mag, mag: 1 } : { x, y, mag };
  }
  function attack() {
    if (!game.running || game.paused || game.player.dashTime > 0 || game.player.attackCooldown > 0) return;
    game.player.attackCooldown = .5; game.slash = .22; const p = game.player; const dir = Math.hypot(p.facingX, p.facingY) || 1; const fx = p.facingX / dir; const fy = p.facingY / dir; const damage = p.weapon?.damage ?? 10;
    let hit = false;
    game.enemies.forEach((enemy) => { const dx = enemy.x - p.x, dy = enemy.y - p.y, dist = Math.hypot(dx, dy); const dot = (dx * fx + dy * fy) / (dist || 1); if (dist < (enemy.boss ? 1.65 : 1.35) && dot > -.12) { enemy.hp -= damage; enemy.hitFlash = .14; hit = true; burst(enemy.x, enemy.y, enemy.boss ? game.theme.palette.bossLight : game.theme.palette.accent, 8); if (enemy.hp <= 0) defeatEnemy(enemy); } });
    game.enemies = game.enemies.filter((enemy) => enemy.hp > 0); if (game.bossFamilyActive && !game.enemies.some((enemy) => enemy.bossFamily)) completeBoss(); if (hit) { game.shake = settings.shake ? .16 : 0; game.flash = settings.flashes ? .06 : 0; tone(120, .09, 'square'); } else tone(240, .04, 'triangle');
  }
  function dash() { if (!game.running || game.paused || game.player.stamina < 28 || game.player.dashTime > 0) return; const d = direction(); const dx = d.mag ? d.x : game.player.facingX; const dy = d.mag ? d.y : game.player.facingY; game.player.stamina -= 28; game.player.dashTime = .18; game.player.dashX = dx; game.player.dashY = dy; game.player.invincible = .28; burst(game.player.x, game.player.y, '#69d8cc', 7); tone(300, .08, 'sawtooth'); }
  function usePotion() { const p = game.player; if (!game.running || game.paused || p.potions <= 0 || p.hp >= p.maxHp) return; p.potions--; p.hp = Math.min(p.maxHp, p.hp + 38); burst(p.x, p.y, '#f2bd57', 12); toast('You used a potion and restored 38 health.'); tone(520, .15, 'sine'); updateHud(); }
  function awardGold(enemy) { const amount = enemy.goldMin + Math.floor(Math.random() * (enemy.goldMax - enemy.goldMin + 1)); game.gold += amount; return amount; }
  function defeatEnemy(enemy) {
    if (enemy.defeated) return;
    enemy.defeated = true;
    const defeated = game.summary.enemies.get(enemy.kind) || { name: enemy.name, count: 0, boss: Boolean(enemy.boss) };
    defeated.count++;
    game.summary.enemies.set(enemy.kind, defeated);
    const gold = awardGold(enemy); burst(enemy.x, enemy.y, enemy.boss ? game.theme.palette.bossLight : game.theme.palette.accent, enemy.boss ? 28 : 8);
    if (enemy.kind === 'giant-slime') { game.bossFamilyActive = true; spawnSlimeSplit(enemy); toast('The giant slime split. Defeat the smaller slimes.'); game.shake = settings.shake ? .45 : 0; game.flash = settings.flashes ? .16 : 0; tone(80, .3, 'sawtooth'); return; }
    if (enemy.kind === 'slime' && enemy.splitLevel < 3) { spawnSlimeSplit(enemy); toast('A slime split. More slimes remain.'); return; }
    if (enemy.boss) { completeBoss(); return; }
    toast(`The ${enemy.name.toLowerCase()} was defeated. You found ${gold} gold.`); tone(enemy.kind === 'guard' ? 130 : 170, .08, 'square');
  }
  function spawnSlimeSplit(source) {
    const splitLevel = (source.splitLevel || 0) + 1; if (splitLevel > 3) return; const hp = Math.max(10, Math.floor(source.maxHp / 2));
    [[-.65, 0], [.65, 0]].forEach(([offsetX, offsetY], index) => { const spot = findNearbyFloor(source.x + offsetX, source.y + offsetY); const profile = { kind: 'slime', name: 'SLIME', hp, damage: 10, goldMin: 5, goldMax: 15 }; game.enemies.push(createEnemy(profile, spot.x, spot.y, { id: `slime-${game.floor}-${splitLevel}-${index}-${Date.now()}`, splitLevel, bossFamily: true })); });
  }
  function findNearbyFloor(x, y) { const candidates = [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1], [x + .7, y + .7], [x - .7, y - .7]]; const spot = candidates.find(([cx, cy]) => canMove(cx, cy, .18)); return spot ? { x: spot[0], y: spot[1] } : { x: game.player.x, y: game.player.y }; }
  function completeBoss() { if (game.floorAdvanceQueued) return; game.summary.clearedFloors.add(game.floor); game.bossDefeated = true; game.bossFamilyActive = false; game.floorAdvanceQueued = true; game.floorAdvanceDelay = 1.2; $('objective-text').textContent = 'The next floor is open.'; toast(`The ${game.profile.boss.name.toLowerCase()} was defeated.`); game.shake = settings.shake ? .45 : 0; game.flash = settings.flashes ? .16 : 0; tone(80, .3, 'sawtooth'); }
  function update(dt) {
    if (!game.running || game.paused) return;
    game.elapsed += dt;
    // Advance with game time so pausing and restarting also stop the delay.
    if (game.floorAdvanceQueued) {
      game.floorAdvanceDelay -= dt;
      if (game.floorAdvanceDelay <= 0) {
        if (game.floor >= 3) endRun(true);
        else { beginFloor(game.floor + 1); toast(`The ${game.theme.name.toLowerCase()} floor begins.`); }
        return;
      }
    }
    const p = game.player; p.invincible = Math.max(0, p.invincible - dt); p.dashTime = Math.max(0, p.dashTime - dt); p.attackCooldown = Math.max(0, p.attackCooldown - dt); game.slash = Math.max(0, game.slash - dt); game.shake = Math.max(0, game.shake - dt); game.flash = Math.max(0, game.flash - dt);
    if (p.sprintExhausted && p.stamina >= p.maxStamina) p.sprintExhausted = false;
    const sprinting = input.sprint && !p.sprintExhausted && p.stamina > 0;
    const recoveryRate = 18 + (p.stamina / p.maxStamina) * 30;
    p.stamina = Math.min(p.maxStamina, p.stamina + (sprinting ? 9 : recoveryRate) * dt);
    const d = direction(); if (d.mag) { p.facingX = d.x; p.facingY = d.y; }
    if (p.dashTime > 0) tryMove(p, p.dashX * 7 * dt, p.dashY * 7 * dt, .18); else if (d.mag) { const speed = sprinting ? 3.9 : 2.35; if (sprinting) { p.stamina = Math.max(0, p.stamina - 25 * dt); if (p.stamina <= 0) { p.stamina = 0; p.sprintExhausted = true; } } tryMove(p, d.x * speed * dt, d.y * speed * dt, .22); }
    game.enemies.forEach((enemy) => updateEnemy(enemy, dt));
    game.chests.forEach((chest) => { if (!chest.open && Math.hypot(chest.x - p.x, chest.y - p.y) < .75) openChest(chest); });
    if (!game.bossAlerted && Math.hypot(game.bossPosition.x - p.x, game.bossPosition.y - p.y) < 4.1) { game.bossAlerted = true; $('boss-alert').classList.remove('hidden'); toast(`The ${game.profile.boss.name.toLowerCase()} is nearby.`); tone(70, .28, 'sawtooth'); }
    game.particles.forEach((particle) => { particle.life -= dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vx *= .96; particle.vy *= .96; }); game.particles = game.particles.filter((particle) => particle.life > 0); updateHud();
  }
  function updateEnemy(enemy, dt) {
    if (enemy.hp <= 0) return; enemy.hitFlash = Math.max(0, enemy.hitFlash - dt); enemy.slash = Math.max(0, enemy.slash - dt); enemy.attackCooldown -= dt; const p = game.player; const dx = p.x - enemy.x, dy = p.y - enemy.y, dist = Math.hypot(dx, dy);
    const kingCommitted = enemy.kind === 'king' && (enemy.kingWindup > 0 || enemy.slash > 0);
    if (dist > 0 && !kingCommitted) { enemy.facingX = dx / dist; enemy.facingY = dy / dist; } const aggro = enemy.boss ? 12 : 6.5;
    if (enemy.kind === 'warden' && dist <= 10) {
      if (!enemy.initialGuardsSpawned) { summonGuards(enemy, 5, false); enemy.initialGuardsSpawned = true; enemy.summonTimer = 10 + Math.random() * 5; }
      else { enemy.summonTimer -= dt; if (enemy.summonTimer <= 0) { summonGuards(enemy); enemy.summonTimer = 10 + Math.random() * 5; } }
    }
    if (enemy.kind === 'king') { enemy.healTimer -= dt; if (enemy.healTimer <= 0) { const healed = Math.min(KING_HEAL_AMOUNT, enemy.maxHp - enemy.hp); enemy.hp += healed; enemy.healTimer += KING_HEAL_INTERVAL; if (healed > 0) { burst(enemy.x, enemy.y, game.theme.palette.bossLight, 18); toast(`The king recovered ${healed} health.`); tone(380, .16, 'sine'); } } }
    const kingStartingWindup = enemy.kind === 'king' && dist <= KING_DETECT_RANGE && enemy.attackCooldown <= 0;
    const stopDistance = enemy.kind === 'giant-slime' || enemy.kind === 'slime' ? .45 : enemy.boss ? 1.35 : .8; if (!kingCommitted && !kingStartingWindup && dist < aggro && dist > stopDistance) { const speed = enemy.boss ? .63 : enemy.kind === 'knight' || enemy.kind === 'prisoner' ? .72 : enemy.kind === 'bat' ? 1.15 : .9; tryMove(enemy, dx / dist * speed * dt, dy / dist * speed * dt, enemy.boss ? .38 : .25); }
    if (enemy.kind === 'warden') return;
    if (enemy.kind === 'king') {
      if (enemy.kingWindup > 0) {
        enemy.kingWindup -= dt;
        if (enemy.kingWindup <= 0) {
          enemy.kingWindup = 0;
          enemy.slash = .38;
          enemy.attackCooldown = KING_COOLDOWN;
          const inArc = dist === 0 || (dx * enemy.facingX + dy * enemy.facingY) / dist >= Math.cos(KING_SLASH_ARC) - 1e-10;
          if (dist < KING_SLASH_RANGE && inArc && p.invincible <= 0) {
            p.hp = Math.max(0, p.hp - enemy.damage);
            game.shake = settings.shake ? .24 : 0;
            game.flash = settings.flashes ? .06 : 0;
            burst(p.x, p.y, game.theme.palette.bossLight, 8);
            tone(105, .12, 'square');
            if (p.hp <= 0) endRun(false, 'You fainted');
          }
        }
      } else if (kingStartingWindup && !kingCommitted) {
        // Commit to this position and direction, even if the player retreats.
        enemy.kingWindup = KING_WINDUP;
      }
      return;
    }
    const contactRange = enemy.kind === 'giant-slime' || enemy.kind === 'slime' ? .7 : enemy.boss ? 1.45 : .82;
    if (dist < contactRange && enemy.attackCooldown <= 0 && p.invincible <= 0) { p.hp = Math.max(0, p.hp - enemy.damage); enemy.attackCooldown = enemy.boss ? 1.25 : 1.05; game.shake = settings.shake ? .2 : 0; game.flash = settings.flashes ? .05 : 0; burst(p.x, p.y, game.theme.palette.bossLight, 6); tone(90, .08, 'square'); if (p.hp <= 0) endRun(false, 'You fainted'); }
    else if (enemy.attackCooldown <= 0) enemy.attackCooldown = enemy.boss ? 1.2 : .8;
  }
  function summonGuards(warden, fixedCount = null, announce = true) { const count = fixedCount ?? (4 + Math.floor(Math.random() * 4)); for (let i = 0; i < count; i++) { const spot = findNearbyFloor(warden.x + (Math.random() - .5) * 5, warden.y + (Math.random() - .5) * 5); game.enemies.push(createEnemy({ kind: 'guard', name: 'GUARD', hp: 30, damage: 35, goldMin: 5, goldMax: 15 }, spot.x, spot.y, { id: `guard-${Date.now()}-${i}` })); } if (announce) toast(`The warden summoned ${count} guards.`); burst(warden.x, warden.y, game.theme.palette.bossLight, 18); }
  function rollTier() { const chances = TIER_CHANCES[game.floor - 1]; const roll = Math.random(); if (roll < chances.rare) return 'rare'; if (roll < chances.rare + chances.uncommon) return 'uncommon'; return 'common'; }
  function openChest(chest) {
    if (chest.open) return;
    chest.open = true; const tier = rollTier(); const choices = ITEM_TIERS[tier]; const item = { ...choices[Math.floor(Math.random() * choices.length)], tier };
    collectGear(item);
    const current = item.slot === 'weapon' ? game.inventory.weapon : game.inventory.armor[item.slot]; const better = !current || (item.damage || item.armor) > (current.damage || current.armor);
    burst(chest.x, chest.y, game.theme.palette.chest, 14); tone(660, .13, 'sine');
    if (better) { if (item.slot === 'weapon') game.inventory.weapon = item; else game.inventory.armor[item.slot] = item; game.player.weapon = game.inventory.weapon; const previousMax = game.player.maxHp; game.player.maxHp = 100 + armorBonus(); if (game.player.maxHp > previousMax) game.player.hp += game.player.maxHp - previousMax; toast(`You equipped the ${item.name.toLowerCase()}.`); }
    else toast(`You found a ${item.name.toLowerCase()}, but your current equipment is better.`);
    updateHud();
  }
  function collectGear(item) {
    const found = game.summary.gear.get(item.name) || { name: item.name, tier: item.tier, count: 0 };
    found.count++;
    game.summary.gear.set(item.name, found);
  }
  function burst(x, y, color, amount) { for (let i = 0; i < amount; i++) { const angle = Math.random() * TAU; const speed = .4 + Math.random() * 1.5; game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: .25 + Math.random() * .4, maxLife: .65, color, size: .06 + Math.random() * .08 }); } }
  function rayReachesCell(targetX, targetY, pointX, pointY) {
    const startX = game.player.x;
    const startY = game.player.y;
    const rayDX = pointX - startX;
    const rayDY = pointY - startY;
    const distance = Math.hypot(rayDX, rayDY);
    if (!distance || distance > VISIBILITY_DISTANCE) return false;

    let cellX = Math.floor(startX);
    let cellY = Math.floor(startY);
    if (cellX === targetX && cellY === targetY) return true;

    const stepX = rayDX > 0 ? 1 : rayDX < 0 ? -1 : 0;
    const stepY = rayDY > 0 ? 1 : rayDY < 0 ? -1 : 0;
    const deltaX = stepX ? Math.abs(1 / rayDX) : Infinity;
    const deltaY = stepY ? Math.abs(1 / rayDY) : Infinity;
    const nextX = stepX > 0 ? cellX + 1 : cellX;
    const nextY = stepY > 0 ? cellY + 1 : cellY;
    let sideX = stepX ? Math.abs((nextX - startX) / rayDX) : Infinity;
    let sideY = stepY ? Math.abs((nextY - startY) / rayDY) : Infinity;

    // Walk the exact grid cells crossed by the ray. The target cell is accepted
    // before the wall test so an entire wall block lights up when it is hit.
    for (let crossed = 0; crossed < game.mapWidth + game.mapHeight; crossed++) {
      if (sideX < sideY - RAY_EPSILON) {
        cellX += stepX;
        sideX += deltaX;
      } else if (sideY < sideX - RAY_EPSILON) {
        cellY += stepY;
        sideY += deltaY;
      } else {
        // A corner crossing touches both cells. Test both so diagonal walls
        // cannot be seen through because of a single precision edge case.
        const cornerX = cellX + stepX;
        const cornerY = cellY + stepY;
        if (stepX && cornerX === targetX && cellY === targetY) return true;
        if (stepY && cellX === targetX && cornerY === targetY) return true;
        // Treat an exact grid-corner crossing as a single diagonal step. The
        // next cell is still checked immediately below, so normal walls stop
        // the ray, but a corner cannot create an artificial dark wedge.
        cellX = cornerX;
        cellY = cornerY;
        sideX += deltaX;
        sideY += deltaY;
      }

      if (cellX === targetX && cellY === targetY) return true;
      if (isWall(cellX + .5, cellY + .5)) return false;
      if (Math.min(sideX, sideY) > distance + RAY_EPSILON) return false;
    }
    return false;
  }
  function getCellVisibility(targetX, targetY) {
    if (!game.player) return { visible: true, full: true, mask: [] };
    const cacheKey = `${targetX},${targetY}`;
    if (game.rayCache?.has(cacheKey)) return game.rayCache.get(cacheKey);
    if (!isTerrain(game.map[targetY]?.[targetX])) {
      const hidden = { visible: false, full: false, mask: [] };
      game.rayCache?.set(cacheKey, hidden);
      return hidden;
    }
    const cellCenterX = targetX + .5;
    const cellCenterY = targetY + .5;
    if (Math.hypot(cellCenterX - game.player.x, cellCenterY - game.player.y) > VISIBILITY_DISTANCE + .8) {
      const hidden = { visible: false, full: false, mask: [] };
      game.rayCache?.set(cacheKey, hidden);
      return hidden;
    }

    // Keep the cells immediately around the player solid. Applying the
    // sub-cell mask here creates artificial diagonal wedges around the player
    // even though the player is already occupying and illuminating this area.
    const playerCellX = Math.floor(game.player.x);
    const playerCellY = Math.floor(game.player.y);
    if (Math.abs(targetX - playerCellX) <= PLAYER_CELL_RADIUS && Math.abs(targetY - playerCellY) <= PLAYER_CELL_RADIUS) {
      const nearby = { visible: true, full: true, mask: [], grid: FLOOR_VISIBILITY_GRID };
      game.rayCache?.set(cacheKey, nearby);
      return nearby;
    }

    // Walls are intentionally binary: one ray touching a wall lights up the
    // entire wall block. This keeps wall silhouettes solid and readable.
    if (game.map[targetY]?.[targetX] === '#') {
      for (let sampleY = 0; sampleY < VISIBILITY_SAMPLES; sampleY++) {
        for (let sampleX = 0; sampleX < VISIBILITY_SAMPLES; sampleX++) {
          const pointX = targetX + (sampleX + .5) / VISIBILITY_SAMPLES;
          const pointY = targetY + (sampleY + .5) / VISIBILITY_SAMPLES;
          if (rayReachesCell(targetX, targetY, pointX, pointY)) {
            const visibleWall = { visible: true, full: true, mask: [] };
            game.rayCache?.set(cacheKey, visibleWall);
            return visibleWall;
          }
        }
      }
      const hiddenWall = { visible: false, full: false, mask: [] };
      game.rayCache?.set(cacheKey, hiddenWall);
      return hiddenWall;
    }

    // Floors use a sub-cell mask. A wall can therefore hide part of a floor
    // block instead of making the whole floor block pop in or out at once.
    const mask = [];
    const samples = FLOOR_VISIBILITY_GRID;
    for (let sampleY = 0; sampleY < samples; sampleY++) {
      for (let sampleX = 0; sampleX < samples; sampleX++) {
        const pointX = targetX + (sampleX + .5) / samples;
        const pointY = targetY + (sampleY + .5) / samples;
        const nearPlayer = Math.hypot(pointX - game.player.x, pointY - game.player.y) <= PLAYER_LIGHT_RADIUS;
        if (nearPlayer || rayReachesCell(targetX, targetY, pointX, pointY)) mask.push(sampleY * samples + sampleX);
      }
    }
    const visibleFloor = { visible: mask.length > 0, full: mask.length === samples * samples, mask, grid: samples };
    game.rayCache?.set(cacheKey, visibleFloor);
    return visibleFloor;
  }
  function pointIsVisible(x, y) {
    const cellX = Math.floor(x), cellY = Math.floor(y);
    const visibility = getCellVisibility(cellX, cellY);
    if (!visibility.visible) return false;
    if (visibility.full) return true;
    const grid = visibility.grid;
    const sampleX = Math.min(grid - 1, Math.floor((x - cellX) * grid));
    const sampleY = Math.min(grid - 1, Math.floor((y - cellY) * grid));
    return visibility.mask.includes(sampleY * grid + sampleX);
  }
  function wallIsBright(x, y, previousVisibleCells) {
    const directlyLit = (wx, wy) => getCellVisibility(wx, wy).visible || previousVisibleCells.has(`${wx},${wy}`);
    if (directlyLit(x, y)) return true;
    // A room corner has two perpendicular wall neighbors around a diagonal
    // floor tile. Light it from either neighbor without changing the ray mask
    // or spreading light along an entire wall.
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      if (game.map[y]?.[x + sx] === '#' && game.map[y + sy]?.[x] === '#' && game.map[y + sy]?.[x + sx] === '.' &&
          (directlyLit(x + sx, y) || directlyLit(x, y + sy))) return true;
    }
    return false;
  }
  function isTerrain(cell) { return cell === '.' || cell === '#'; }
  function render() {
    const { w, h } = screenSize(); if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = VOID_COLOR; ctx.fillRect(0, 0, w, h);
    const { tile, ox, oy } = tileMetrics();
    const shakeX = game.shake ? (Math.random() - .5) * game.shake * 22 : 0;
    const shakeY = game.shake ? (Math.random() - .5) * game.shake * 22 : 0;
    ctx.save(); ctx.translate(shakeX, shakeY);
    // Keep the previous wall mask for one frame. A wall that is exactly on a
    // ray boundary should not blink off while the player is moving past it.
    const previousVisibleCells = game.visibleCells;
    game.visibleCells = new Set();
    game.rayCache = new Map();
    const minX = Math.max(0, Math.floor((-ox) / tile) - 1), maxX = Math.min(game.mapWidth - 1, Math.ceil((w - ox) / tile) + 1);
    const minY = Math.max(0, Math.floor((-oy) / tile) - 1), maxY = Math.min(game.mapHeight - 1, Math.ceil((h - oy) / tile) + 1);
    // Clip all drawing to actual terrain. Borders, glow, particles, swords and
    // combat flashes cannot spill into the solid-black void, even while shaking.
    ctx.beginPath();
    for (let y = minY; y <= maxY; y++) {
      let runStart = null;
      for (let x = minX; x <= maxX + 1; x++) {
        if (x <= maxX && isTerrain(game.map[y][x])) { if (runStart === null) runStart = x; }
        else if (runStart !== null) { ctx.rect(ox + runStart * tile, oy + y * tile, (x - runStart) * tile, tile); runStart = null; }
      }
    }
    ctx.clip();
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (!isTerrain(game.map[y][x])) continue;
      const key = `${x},${y}`;
      const visibility = getCellVisibility(x, y);
      const visible = visibility.visible;
      const brightWall = game.map[y][x] === '#' && wallIsBright(x, y, previousVisibleCells);
      if (visible) game.visibleCells.add(key);
      // Terrain remains readable in deep shadow; objects still use the ray mask.
      drawTile(x, y, tile, ox, oy, brightWall ? { ...visibility, full: true } : visibility);
    }
    game.chests.forEach((chest) => { if (pointIsVisible(chest.x, chest.y)) drawChest(chest, tile, ox, oy); }); game.enemies.forEach((enemy) => { if (pointIsVisible(enemy.x, enemy.y)) drawEnemy(enemy, tile, ox, oy); }); drawPlayer(tile, ox, oy); game.particles.forEach((particle) => { if (!pointIsVisible(particle.x, particle.y)) return; const s = worldToScreen(particle.x, particle.y); ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife); ctx.fillStyle = particle.color; ctx.fillRect(s.x - particle.size * tile / 2, s.y - particle.size * tile / 2, particle.size * tile, particle.size * tile); }); ctx.globalAlpha = 1;
    if (game.flash) { ctx.fillStyle = `rgba(255,${game.flash > .1 ? 150 : 210},${game.flash > .1 ? 105 : 190},${game.flash * 1.2})`; ctx.fillRect(-shakeX, -shakeY, w, h); }
    ctx.restore();
  }
  function drawTile(x, y, tile, ox, oy, visibility = { full: true }) {
    const px = ox + x * tile;
    const py = oy + y * tile;
    const cell = game.map[y][x];
    if (!isTerrain(cell)) return;
    const palette = game.theme.palette;
    if (cell === '#') {
      ctx.fillStyle = palette.wall;
      ctx.fillRect(px, py, tile + .5, tile + .5);
      if (!visibility.full) { ctx.fillStyle = WALL_SHADOW; ctx.fillRect(px, py, tile + .5, tile + .5); }
      return;
    }

    const floorColor = (x * 7 + y * 13) % 4 === 0 ? palette.floorAlt : palette.floor;
    ctx.fillStyle = floorColor;
    ctx.fillRect(px, py, tile + .5, tile + .5);
    if (!visibility.full) {
      // Keep the floor's color underneath the shadow, then light only the
      // subcells reached by the raycast. Fully hidden tiles stay darkened.
      ctx.fillStyle = TERRAIN_SHADOW;
      ctx.fillRect(px, py, tile + .5, tile + .5);
      ctx.fillStyle = floorColor;
      const subTile = tile / visibility.grid;
      (visibility.mask || []).forEach((index) => {
        const subX = index % visibility.grid;
        const subY = Math.floor(index / visibility.grid);
        ctx.fillRect(px + subX * subTile, py + subY * subTile, subTile + .8, subTile + .8);
      });
    }

    // Keep the simple floor detail only on complete tiles so it cannot draw
    // a border across a section that the raycast has hidden.
    if (visibility.full) {
      ctx.strokeStyle = 'rgba(235,229,209,.08)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + .5, py + .5, tile - 1, tile - 1);
      if ((x * 31 + y * 11) % 11 === 0) {
        ctx.fillStyle = 'rgba(20,18,14,.24)';
        ctx.fillRect(px + tile * .22, py + tile * .58, tile * .22, 1);
      }
    }
  }
  function drawChest(chest, tile, ox, oy) { const s = worldToScreen(chest.x, chest.y); const palette = game.theme.palette; ctx.save(); ctx.translate(s.x, s.y); ctx.fillStyle = chest.open ? palette.grout : palette.chest; ctx.fillRect(-tile * .25, -tile * .17, tile * .5, tile * .34); ctx.fillStyle = chest.open ? palette.wallTop : palette.accent; ctx.fillRect(-tile * .23, -tile * .19, tile * .46, tile * .1); ctx.fillStyle = palette.wall; ctx.fillRect(-tile * .04, -tile * .06, tile * .08, tile * .13); ctx.restore(); }
  function drawEnemy(enemy, tile, ox, oy) {
    const s = worldToScreen(enemy.x, enemy.y); const palette = game.theme.palette; const slimeRadius = enemy.kind === 'slime' ? Math.max(.11, .3 - (enemy.splitLevel || 1) * .055) : .25; const r = tile * (enemy.boss ? .46 : slimeRadius); ctx.save(); ctx.translate(s.x, s.y); const ink = palette.wall; const cloth = enemy.hitFlash ? palette.playerLight : enemy.kind === 'knight' || enemy.kind === 'guard' ? '#737a7a' : enemy.kind === 'peasant' ? '#78604f' : enemy.kind === 'prisoner' ? '#a09a87' : palette.enemy;
    if (enemy.kind === 'bat') {
      ctx.fillStyle = cloth; ctx.beginPath(); ctx.moveTo(-r * .15, 0); ctx.lineTo(-r * 1.55, -r * .7); ctx.lineTo(-r * 1.2, r * .6); ctx.lineTo(-r * .25, r * .2); ctx.lineTo(r * .25, r * .2); ctx.lineTo(r * 1.2, r * .6); ctx.lineTo(r * 1.55, -r * .7); ctx.lineTo(r * .15, 0); ctx.closePath(); ctx.fill(); ctx.fillStyle = palette.boss; ctx.beginPath(); ctx.ellipse(0, 0, r * .45, r * .7, 0, 0, TAU); ctx.fill(); ctx.fillStyle = palette.playerLight; ctx.fillRect(-r * .22, -r * .15, r * .12, r * .12); ctx.fillRect(r * .1, -r * .15, r * .12, r * .12);
    } else if (enemy.kind === 'skeleton') {
      ctx.strokeStyle = palette.playerLight; ctx.fillStyle = palette.playerLight; ctx.lineWidth = Math.max(2, tile * .06); ctx.beginPath(); ctx.arc(0, -r * .45, r * .55, 0, TAU); ctx.fill(); ctx.fillStyle = ink; ctx.fillRect(-r * .3, -r * .5, r * .16, r * .16); ctx.fillRect(r * .14, -r * .5, r * .16, r * .16); ctx.strokeRect(-r * .36, r * .02, r * .72, r * .7); for (let rib = 0; rib < 3; rib++) { ctx.beginPath(); ctx.moveTo(-r * .28, r * (.16 + rib * .17)); ctx.lineTo(r * .28, r * (.16 + rib * .17)); ctx.stroke(); }
    } else if (enemy.kind === 'zombie') {
      ctx.fillStyle = '#667257'; ctx.fillRect(-r * .55, -r * .05, r * 1.1, r * 1.15); ctx.fillStyle = '#899077'; ctx.beginPath(); ctx.arc(0, -r * .58, r * .52, 0, TAU); ctx.fill(); ctx.fillStyle = ink; ctx.fillRect(-r * .25, -r * .65, r * .13, r * .1); ctx.fillRect(r * .12, -r * .65, r * .13, r * .1); ctx.strokeStyle = '#4f5b46'; ctx.lineWidth = Math.max(2, tile * .05); ctx.beginPath(); ctx.moveTo(-r * .65, r * .18); ctx.lineTo(-r * 1.1, -r * .05); ctx.moveTo(r * .65, r * .18); ctx.lineTo(r * 1.1, -.05 * r); ctx.stroke();
    } else if (enemy.kind === 'prisoner') {
      ctx.fillStyle = '#8c8980'; ctx.fillRect(-r * .58, -r * .02, r * 1.16, r * 1.2); ctx.fillStyle = '#b1aa95'; ctx.beginPath(); ctx.arc(0, -r * .58, r * .5, 0, TAU); ctx.fill(); ctx.strokeStyle = '#4f4c47'; ctx.lineWidth = Math.max(2, tile * .06); for (let stripe = -1; stripe <= 1; stripe++) { ctx.beginPath(); ctx.moveTo(stripe * r * .24, 0); ctx.lineTo(stripe * r * .24, r * 1.12); ctx.stroke(); } ctx.fillStyle = palette.accent; ctx.beginPath(); ctx.arc(-r * .68, r * .22, r * .16, 0, TAU); ctx.arc(r * .68, r * .22, r * .16, 0, TAU); ctx.fill();
    } else if (enemy.kind === 'peasant') {
      ctx.fillStyle = '#8a6e56'; ctx.fillRect(-r * .55, -r * .02, r * 1.1, r * 1.08); ctx.fillStyle = '#ba9270'; ctx.beginPath(); ctx.arc(0, -r * .62, r * .48, 0, TAU); ctx.fill(); ctx.fillStyle = '#9a754f'; ctx.beginPath(); ctx.arc(0, -r * .86, r * .65, Math.PI, TAU); ctx.fill(); ctx.fillStyle = ink; ctx.fillRect(-r * .2, -r * .64, r * .1, r * .1); ctx.fillRect(r * .1, -r * .64, r * .1, r * .1);
    } else if (enemy.kind === 'knight' || enemy.kind === 'guard') {
      ctx.fillStyle = cloth; ctx.fillRect(-r * .62, -r * .03, r * 1.24, r * 1.18); ctx.fillStyle = '#aab0ab'; ctx.beginPath(); ctx.arc(0, -r * .58, r * .58, 0, TAU); ctx.fill(); ctx.fillStyle = '#4c5050'; ctx.fillRect(-r * .58, -r * .62, r * 1.16, r * .17); ctx.fillRect(-r * .22, -r * .13, r * .44, r * .12); ctx.strokeStyle = palette.accent; ctx.lineWidth = Math.max(2, tile * .05); ctx.beginPath(); ctx.moveTo(-r * .45, r * .12); ctx.lineTo(r * .45, r * .12); ctx.stroke();
    } else if (enemy.kind === 'giant-slime' || enemy.kind === 'slime') {
      ctx.shadowColor = palette.bossLight; ctx.shadowBlur = tile * (enemy.boss ? .22 : .1); ctx.fillStyle = enemy.hitFlash ? palette.playerLight : palette.boss; ctx.beginPath(); ctx.moveTo(-r, r * .45); ctx.quadraticCurveTo(-r * 1.15, -r * .1, -r * .55, -r * .62); ctx.quadraticCurveTo(0, -r * 1.05, r * .55, -r * .62); ctx.quadraticCurveTo(r * 1.15, -r * .1, r, r * .45); ctx.quadraticCurveTo(0, r * 1.02, -r, r * .45); ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = palette.bossLight; ctx.lineWidth = Math.max(2, tile * .05); ctx.stroke(); ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(-r * .3, -r * .08, r * .1, 0, TAU); ctx.arc(r * .3, -r * .08, r * .1, 0, TAU); ctx.fill();
    } else if (enemy.kind === 'warden' || enemy.kind === 'king') {
      const windingUp = enemy.kind === 'king' && enemy.kingWindup > 0;
      const windupProgress = windingUp ? 1 - enemy.kingWindup / KING_WINDUP : 0;
      const swordAngle = Math.atan2(enemy.facingY, enemy.facingX);
      if (windingUp || enemy.slash > 0) {
        // The ground warning and slash show the actual damage range and arc.
        ctx.save(); ctx.rotate(swordAngle);
        ctx.fillStyle = windingUp ? `rgba(231,155,74,${.14 + windupProgress * .18})` : 'rgba(234,214,154,.3)';
        ctx.strokeStyle = windingUp ? '#e79b4a' : '#ead69a';
        ctx.lineWidth = Math.max(2, tile * .05);
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.arc(0, 0, tile * KING_SLASH_RANGE, -KING_SLASH_ARC, KING_SLASH_ARC);
        ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      ctx.fillStyle = enemy.kind === 'king' ? '#7d4c4e' : palette.boss;
      ctx.fillRect(-r * .68, -r * .02, r * 1.36, r * 1.25);
      ctx.fillStyle = enemy.kind === 'king' ? '#d0aa58' : '#6d7672';
      ctx.beginPath(); ctx.arc(0, -r * .6, r * .56, 0, TAU); ctx.fill();
      ctx.fillStyle = ink; ctx.fillRect(-r * .23, -r * .64, r * .13, r * .1); ctx.fillRect(r * .1, -r * .64, r * .13, r * .1);
      if (enemy.kind === 'king') {
        ctx.fillStyle = '#d0aa58'; ctx.beginPath();
        ctx.moveTo(-r * .5, -r * 1.02); ctx.lineTo(-r * .3, -r * 1.35); ctx.lineTo(0, -r * 1.08); ctx.lineTo(r * .28, -r * 1.35); ctx.lineTo(r * .5, -r * 1.02); ctx.closePath(); ctx.fill();
        const swingProgress = enemy.slash > 0 ? 1 - enemy.slash / .38 : 0;
        const swordOffset = windingUp ? -KING_SLASH_ARC - windupProgress * .6 : enemy.slash > 0 ? -KING_SLASH_ARC + swingProgress * KING_SLASH_ARC * 2 : 0;
        ctx.save(); ctx.rotate(swordAngle + swordOffset);
        ctx.strokeStyle = windingUp ? '#ffcc80' : enemy.slash > 0 ? '#ead69a' : '#aaa89d';
        ctx.lineWidth = Math.max(2, tile * .07);
        ctx.beginPath(); ctx.moveTo(r * .35, 0); ctx.lineTo(tile * KING_SLASH_RANGE * .95, 0); ctx.stroke();
        ctx.strokeStyle = '#d0aa58'; ctx.lineWidth = Math.max(2, tile * .1);
        ctx.beginPath(); ctx.moveTo(r * .34, -r * .22); ctx.lineTo(r * .34, r * .22); ctx.stroke(); ctx.restore();
      }
    } else { ctx.fillStyle = cloth; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); }
    ctx.restore(); drawBar(enemy, s.x, s.y - tile * (enemy.boss ? .86 : .55), tile * (enemy.boss ? 1.3 : .7));
  }
  function drawBar(entity, x, y, width) { if (entity.hp >= entity.maxHp) return; ctx.fillStyle = 'rgba(10,9,8,.75)'; ctx.fillRect(x - width / 2, y, width, 3); ctx.fillStyle = entity.boss ? game.theme.palette.bossLight : game.theme.palette.accent; ctx.fillRect(x - width / 2, y, width * Math.max(0, entity.hp / entity.maxHp), 3); }
  function drawPlayer(tile, ox, oy) { const p = game.player, s = worldToScreen(p.x, p.y), palette = game.theme.palette; ctx.save(); ctx.translate(s.x, s.y); if (p.invincible > 0) ctx.globalAlpha = .55 + Math.sin(performance.now() / 50) * .35; ctx.shadowColor = palette.player; ctx.shadowBlur = tile * .22; ctx.fillStyle = palette.player; ctx.beginPath(); ctx.arc(0, 0, tile * .3, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = palette.playerLight; ctx.lineWidth = Math.max(2, tile * .06); ctx.stroke(); ctx.fillStyle = palette.playerLight; ctx.beginPath(); ctx.moveTo(p.facingX * tile * .38, p.facingY * tile * .38); ctx.lineTo(p.facingX * tile * .08 - p.facingY * tile * .15, p.facingY * tile * .08 + p.facingX * tile * .15); ctx.lineTo(p.facingX * tile * .08 + p.facingY * tile * .15, p.facingY * tile * .08 - p.facingX * tile * .15); ctx.fill(); if (game.slash) { ctx.strokeStyle = `rgba(196,188,114,${game.slash / .22})`; ctx.lineWidth = tile * .12; ctx.beginPath(); ctx.arc(0, 0, tile * 1.1, Math.atan2(p.facingY, p.facingX) - .8, Math.atan2(p.facingY, p.facingX) + .8); ctx.stroke(); } ctx.restore(); }
  function updateHud() { if (!game.player) return; const p = game.player; const armor = game.inventory.armor; $('health-fill').style.width = `${Math.max(0, p.hp / p.maxHp) * 100}%`; $('stamina-fill').style.width = `${Math.max(0, p.stamina / p.maxStamina) * 100}%`; $('health-text').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`; $('potion-count').textContent = p.potions; $('gold-count').textContent = game.gold; $('weapon-readout').textContent = p.weapon?.name ?? 'UNARMED'; $('head-readout').textContent = armor.helmet?.name ?? 'NONE'; $('torso-readout').textContent = armor.chest?.name ?? 'NONE'; $('legs-readout').textContent = armor.legs?.name ?? 'NONE'; }
  function toast(message) { const node = $('game-toast'); node.textContent = message; node.classList.add('show'); clearTimeout(game.toastTimer); game.toastTimer = setTimeout(() => node.classList.remove('show'), 1800); }
  function renderRecap(id, entries, emptyCopy, gear = false) {
    const list = $(id);
    list.replaceChildren();
    if (!entries.length) {
      const row = document.createElement('li'); row.className = 'recap-empty'; row.textContent = emptyCopy; list.append(row); return;
    }
    entries.forEach((entry) => {
      const row = document.createElement('li');
      const label = document.createElement('span'); label.textContent = entry.name.toLowerCase();
      const detail = document.createElement('small'); detail.textContent = gear ? entry.tier : entry.boss ? 'Boss' : 'Enemy';
      const count = document.createElement('b'); count.textContent = `×${entry.count}`;
      label.append(detail); row.append(label, count); list.append(row);
    });
  }
  function endRun(won, reason = 'The run ended') {
    if (!game.running) return;
    game.running = false; game.paused = false; stopLoop(); resetInput();
    const previousBest = bestGold;
    const newRecord = game.gold > previousBest;
    if (newRecord) {
      bestGold = game.gold;
      try { localStorage.setItem(bestGoldKey, String(bestGold)); } catch { recordStorageAvailable = false; }
    }
    $('menu-best-gold').textContent = bestGold;
    $('menu-record-scope').textContent = recordStorageAvailable ? 'On this device' : 'This session';
    $('result-record-scope').textContent = recordStorageAvailable ? 'on this device' : 'this session';
    $('result-best-gold').textContent = bestGold;
    $('result-record').classList.toggle('is-record', newRecord);
    $('result-record-label').textContent = newRecord ? 'New personal best!' : 'Personal best';
    $('result-record-copy').textContent = newRecord ? (previousBest ? `${game.gold - previousBest} gold above your previous best of ${previousBest}.` : 'Your first gold record. A run to build on.') : game.gold === bestGold && bestGold > 0 ? 'You matched your best haul.' : bestGold > 0 ? `${bestGold - game.gold} gold away from your best haul.` : 'Your first gold record is still ahead.';
    const summary = game.summary;
    const gear = [...summary.gear.values()];
    const enemies = [...summary.enemies.values()].sort((a, b) => Number(b.boss) - Number(a.boss));
    const kills = enemies.reduce((total, enemy) => total + enemy.count, 0);
    const gearCount = gear.reduce((total, item) => total + item.count, 0);
    const cleared = summary.clearedFloors.size;
    $('result-kicker').textContent = won ? 'All three floors conquered' : 'Your run, remembered';
    $('result-title').textContent = won ? 'Run complete' : 'Run ended';
    $('result-copy').textContent = won ? 'The king has fallen. The dungeon is behind you.' : `${reason}. You reached the ${FLOOR_THEMES[summary.furthestFloor - 1].name.toLowerCase()}.`;
    $('result-floor').textContent = `${String(summary.furthestFloor).padStart(2, '0')} / 03`;
    $('result-gold').textContent = game.gold;
    $('result-kills').textContent = kills;
    $('result-time').textContent = formatTime(game.elapsed);
    $('result-progress').textContent = `${FLOOR_THEMES[summary.furthestFloor - 1].name} · ${cleared} / 3 floors cleared`;
    $('result-gear-count').textContent = gearCount;
    $('result-enemy-count').textContent = kills;
    renderRecap('result-gear', gear, 'No gear found this time. Chests hold your next upgrade.', true);
    renderRecap('result-enemies', enemies, 'No enemies defeated this time. Your next run starts fresh.');
    showScreen('result-screen');
    $('result-overview')?.scrollTo?.(0, 0);
    document.querySelector('.run-recap')?.scrollTo(0, 0);
    $('result-title').focus({ preventScroll: true });
    tone(330, .15, 'sine');
    tone(won ? 440 : 392, .18, 'sine', .12);
    if (won) tone(660, .3, 'sine', .26);
  }
  function ensureAudio() { if (!audioContext) { try { audioContext = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } } if (audioContext.state === 'suspended') audioContext.resume(); }
  function tone(freq, duration, type, delay = 0) { if (!audioContext || settings.volume <= 0) return; try { const osc = audioContext.createOscillator(); const gain = audioContext.createGain(); const start = audioContext.currentTime + delay; osc.type = type; osc.frequency.value = freq; gain.gain.setValueAtTime((settings.volume / 100) * .035, start); gain.gain.exponentialRampToValueAtTime(.0001, start + duration); osc.connect(gain).connect(audioContext.destination); osc.start(start); osc.stop(start + duration); } catch { /* audio optional */ } }
  function loop(now) { animationFrame = 0; if (!game.running || game.paused) return; const dt = Math.min(.034, (now - game.last) / 1000 || .016); game.last = now; update(dt); if (!game.running || game.paused) return; render(); animationFrame = requestAnimationFrame(loop); }

  setupUi(); resizeCanvas();
})();
