const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGame(storage = new Map(), storageUnavailable = false) {
  const nodes = new Map();
  const listeners = new Map();
  const frames = new Map();
  const timers = new Map();
  const canvasCalls = [];
  const context2d = new Proxy({}, { get(target, method) { return method in target ? target[method] : (...args) => canvasCalls.push({ method, args, fillStyle: target.fillStyle }); } });
  let nextId = 1;
  function makeNode() {
    const classes = new Set();
    return {
      children: [], style: {},
      classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) },
      setAttribute() {}, querySelector() { return {}; }, focus() {}, scrollTo() {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; }
    };
  }
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      ...makeNode(),
      addEventListener(type, handler) { listeners.set(`${id}:${type}`, handler); },
      getBoundingClientRect() { return { width: 960, height: 540 }; },
      getContext() { return context2d; }
    });
    return nodes.get(id);
  }
  const window = { devicePixelRatio: 1, addEventListener(type, handler) { listeners.set(`window:${type}`, handler); } };
  const document = {
    hidden: false, getElementById: node, querySelectorAll: () => [],
    querySelector: () => null, createElement: makeNode,
    addEventListener(type, handler) { listeners.set(`document:${type}`, handler); }
  };
  const context = vm.createContext({ window, document, console, performance: { now: () => 1000 },
    localStorage: {
      getItem(key) { if (storageUnavailable) throw new Error('Storage unavailable'); return storage.get(key) ?? null; },
      setItem(key, value) { if (storageUnavailable) throw new Error('Storage unavailable'); storage.set(key, value); }
    },
    requestAnimationFrame(fn) { const id = nextId++; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn) { const id = nextId++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, `globalThis.api = { game, input, settings, startGame, pauseGame, resumeGame, returnToMenu, completeBoss, update, attack, dash, usePotion, generateMap, endRun, createEnemy, updateEnemy, drawEnemy, collectGear, defeatEnemy, openChest, beginFloor, render, pointIsVisible, getCellVisibility, tileMetrics, wallIsBright, isWall, canMove }; })();`), context);
  return { ...context.api, frames, timers, listeners, document, node, storage, canvasCalls };
}

test('pause/resume and restart keep a single animation loop', () => {
  const g = loadGame();
  g.startGame();
  assert.equal(g.frames.size, 1);
  const [frameId, frame] = [...g.frames][0];
  g.frames.delete(frameId);
  frame(1016);
  assert.equal(g.frames.size, 1);
  g.pauseGame();
  assert.equal(g.frames.size, 0);
  g.resumeGame();
  assert.equal(g.frames.size, 1);
  g.startGame();
  assert.equal(g.frames.size, 1);
  g.returnToMenu();
  assert.equal(g.frames.size, 0);
});

test('losing focus, hiding the page, and pausing release movement and sprint', () => {
  const g = loadGame();
  g.startGame();
  for (const reset of [() => g.listeners.get('window:blur')(), () => {
    g.document.hidden = true;
    g.listeners.get('document:visibilitychange')();
  }, g.pauseGame]) {
    g.input.keys.add('w');
    Object.assign(g.input.joystick, { active: true, x: 1, y: 1 });
    g.input.sprint = true;
    reset();
    assert.equal(g.input.keys.size, 0);
    assert.equal(g.input.joystick.active, false);
    assert.equal(g.input.joystick.x, 0);
    assert.equal(g.input.joystick.y, 0);
    assert.equal(g.input.sprint, false);
  }
});

test('floor transitions wait through pause and cannot leak into a restart', () => {
  const g = loadGame();
  g.startGame();
  g.completeBoss();
  g.pauseGame();
  for (const fn of [...g.timers.values()]) fn();
  g.update(2);
  assert.equal(g.game.floor, 1);
  g.resumeGame();
  g.update(.6);
  assert.equal(g.game.floor, 1);
  g.update(.61);
  assert.equal(g.game.floor, 2);
  g.completeBoss();
  g.startGame();
  for (const fn of [...g.timers.values()]) fn();
  g.update(2);
  assert.equal(g.game.floor, 1);
});

test('combat actions cannot change a paused run', () => {
  const g = loadGame();
  g.startGame();
  g.game.player.hp = 50;
  g.pauseGame();
  g.listeners.get('window:keydown')({ key: 'w', code: 'KeyW' });
  assert.equal(g.input.keys.size, 0);
  g.attack(); g.dash(); g.usePotion();
  assert.equal(g.game.player.hp, 50);
  assert.equal(g.game.player.potions, 2);
  assert.equal(g.game.player.stamina, 100);
  assert.equal(g.game.player.attackCooldown, 0);
});

test('winning and losing stop the run and release controls', () => {
  const g = loadGame();
  g.startGame();
  g.input.keys.add('d');
  g.endRun(false, 'You fainted');
  assert.equal(g.game.running, false);
  assert.equal(g.frames.size, 0);
  assert.equal(g.input.keys.size, 0);
  assert.equal(g.node('result-title').textContent, 'Run ended');
  g.startGame();
  g.game.floor = 3;
  g.completeBoss();
  g.update(1.21);
  assert.equal(g.game.running, false);
  assert.equal(g.frames.size, 0);
  assert.equal(g.node('result-title').textContent, 'Run complete');
});

test('Left Shift mirrors the sprint button in hold and toggle modes; Right Shift is ignored', () => {
  const g = loadGame();
  g.startGame();
  const down = (code, repeat = false) => g.listeners.get('window:keydown')({ key: 'Shift', code, repeat, preventDefault() {} });
  const up = (code) => g.listeners.get('window:keyup')({ key: 'Shift', code });
  down('ShiftRight'); assert.equal(g.input.sprint, false);
  down('ShiftLeft'); assert.equal(g.input.sprint, true);
  up('ShiftRight'); assert.equal(g.input.sprint, true);
  up('ShiftLeft'); assert.equal(g.input.sprint, false);
  g.settings.holdSprint = false;
  down('ShiftLeft'); up('ShiftLeft'); assert.equal(g.input.sprint, true);
  down('ShiftLeft', true); assert.equal(g.input.sprint, true);
  down('ShiftLeft'); assert.equal(g.input.sprint, false);
});

test('generated maps connect the start, boss, chests, and enemies on every floor', () => {
  const g = loadGame();
  for (let seed = 0; seed < 20; seed++) for (let floor = 1; floor <= 3; floor++) {
    g.game.runSeed = seed;
    const map = g.generateMap(floor);
    const visited = new Set();
    const queue = [map.start];
    for (let i = 0; i < queue.length; i++) {
      const { x, y } = queue[i];
      const key = `${x},${y}`;
      if (visited.has(key) || map.grid[y]?.[x] !== '.') continue;
      visited.add(key);
      queue.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
    }
    for (const point of [map.boss, ...map.chests, ...map.spawns]) {
      assert.ok(visited.has(`${Math.floor(point.x)},${Math.floor(point.y)}`), `seed ${seed}, floor ${floor}`);
    }
  }
});

function kingFight() {
  const g = loadGame();
  g.startGame();
  g.game.map = Array.from({ length: 45 }, () => Array(69).fill('.'));
  Object.assign(g.game.player, { x: 13, y: 10 });
  const king = g.createEnemy({ kind: 'king', hp: 750, damage: 60 }, 10, 10, { boss: true });
  g.game.enemies = [king];
  return { g, king };
}

test('N and M jump to the requested floor with complete matching gear and restored health', () => {
  const g = loadGame();
  g.startGame();
  const down = g.listeners.get('window:keydown');
  for (const [key, floor, tier, weapon, hp] of [
    ['n', 2, 'common', 'WOOD BAT', 130],
    ['m', 3, 'uncommon', 'BRONZE SWORD', 160],
    ['N', 2, 'common', 'WOOD BAT', 130]
  ]) {
    g.game.player.hp = 1;
    g.game.player.stamina = 0;
    g.input.keys.add('w');
    g.input.sprint = true;
    g.completeBoss();
    down({ key, repeat: false, preventDefault() {} });
    assert.equal(g.game.floor, floor);
    assert.equal(g.game.player.weapon.name, weapon);
    for (const item of [g.game.inventory.weapon, ...Object.values(g.game.inventory.armor)]) {
      assert.equal(item.tier, tier);
    }
    assert.equal(g.game.player.hp, hp);
    assert.equal(g.game.player.maxHp, hp);
    assert.equal(g.game.player.stamina, 100);
    assert.equal(g.input.keys.size, 0);
    assert.equal(g.input.sprint, false);
    assert.equal(g.game.floorAdvanceQueued, false);
    assert.equal(g.frames.size, 1);
    assert.ok(g.game.enemies.some((enemy) => enemy.boss));
    assert.equal(g.node('weapon-readout').textContent, weapon);
  }
});

test('floor jump shortcuts ignore key repeats, modifier combinations, and paused games', () => {
  const g = loadGame();
  g.startGame();
  const down = g.listeners.get('window:keydown');
  for (const extra of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    down({ key: 'm', repeat: false, preventDefault() {}, ...extra });
    assert.equal(g.game.floor, 1);
  }
  g.pauseGame();
  down({ key: 'n', repeat: false, preventDefault() {} });
  assert.equal(g.game.floor, 1);
});

test('king detects outside his hitbox, winds up for 0.4 seconds, and commits after retreat', () => {
  const { g, king } = kingFight();
  g.updateEnemy(king, .016);
  assert.equal(king.kingWindup, .4);
  assert.equal(king.x, 10);
  g.drawEnemy(king, 32, 0, 0);
  g.game.player.x = 16;
  g.updateEnemy(king, .39);
  assert.ok(king.kingWindup > 0);
  assert.equal(king.slash, 0);
  g.updateEnemy(king, .011);
  assert.equal(king.kingWindup, 0);
  assert.equal(king.slash, .38);
  assert.equal(king.attackCooldown, 2.5);
  assert.equal(king.x, 10);
  assert.equal(g.game.player.hp, 100);
});

test('king hits once after windup, then waits 2.5 seconds before winding up again', () => {
  const { g, king } = kingFight();
  g.game.player.x = 11;
  g.updateEnemy(king, .016);
  assert.equal(g.game.player.hp, 100);
  g.updateEnemy(king, .39);
  assert.equal(g.game.player.hp, 100);
  g.updateEnemy(king, .011);
  assert.equal(g.game.player.hp, 40);
  for (let i = 0; i < 24; i++) g.updateEnemy(king, .1);
  assert.equal(king.kingWindup, 0);
  assert.equal(g.game.player.hp, 40);
  g.updateEnemy(king, .11);
  assert.equal(king.kingWindup, .4);
  assert.equal(g.game.player.hp, 40);
});

test('king locks his aim so players can dodge behind the marked slash', () => {
  const { g, king } = kingFight();
  g.updateEnemy(king, .016);
  Object.assign(g.game.player, { x: 9, y: 11 });
  g.updateEnemy(king, .4);
  assert.equal(king.facingX, 1);
  assert.equal(king.facingY, 0);
  assert.equal(king.slash, .38);
  assert.equal(g.game.player.hp, 100);
  g.drawEnemy(king, 32, 0, 0);
});

test('king slash reaches two tiles across a full forward semicircle', () => {
  for (const [x, y, expectedHp] of [
    [11.9, 10, 40], // Just inside the two-block reach in front.
    [10, 11.9, 40], // Both perpendicular edges are inside the 180-degree arc.
    [10, 8.1, 40],
    [9.9, 11.9, 100], // Behind the king remains safe.
    [12.1, 10, 100] // Beyond two blocks remains safe.
  ]) {
    const { g, king } = kingFight();
    g.updateEnemy(king, .016);
    Object.assign(g.game.player, { x, y });
    g.updateEnemy(king, .4);
    assert.equal(g.game.player.hp, expectedHp, `player at ${x}, ${y}`);
  }
});

test('king heals 35 HP every five seconds and cannot heal beyond his maximum', () => {
  const { g, king } = kingFight();
  g.game.player.x = 40;
  king.hp = 650;
  assert.equal(king.healTimer, 5);
  g.updateEnemy(king, 4.99);
  assert.equal(king.hp, 650);
  g.updateEnemy(king, .02);
  assert.equal(king.hp, 685);
  assert.equal(g.node('game-toast').textContent, 'The king recovered 35 health.');
  g.updateEnemy(king, 4.98);
  assert.equal(king.hp, 685);
  g.updateEnemy(king, .02);
  assert.equal(king.hp, 720);
  g.updateEnemy(king, 5);
  assert.equal(king.hp, 750);
  assert.equal(g.node('game-toast').textContent, 'The king recovered 30 health.');
  g.updateEnemy(king, 5);
  assert.equal(king.hp, 750);
  king.hp = 0;
  g.updateEnemy(king, 5);
  assert.equal(king.hp, 0);
});

test('recap counts all gear finds and enemy defeats once across floors', () => {
  const g = loadGame();
  g.startGame();
  g.collectGear({ name: 'WOOD BAT', tier: 'common' });
  g.collectGear({ name: 'WOOD BAT', tier: 'common' });
  const chest = { x: 5, y: 5, open: false };
  g.openChest(chest);
  g.openChest(chest);
  const bat = () => g.createEnemy({ kind: 'bat', name: 'BAT', hp: 20, goldMin: 5, goldMax: 5 }, 5, 5);
  const first = bat();
  g.defeatEnemy(first);
  g.defeatEnemy(first);
  g.defeatEnemy(bat());
  g.completeBoss();
  g.beginFloor(2);
  assert.equal(g.game.summary.clearedFloors.size, 1);
  assert.equal(g.game.summary.furthestFloor, 2);
  g.endRun(false, 'You fainted');
  assert.equal(g.node('result-gold').textContent, 10);
  assert.equal(g.node('result-kills').textContent, 2);
  assert.equal(g.node('result-gear-count').textContent, 3);
  assert.equal(g.node('result-floor').textContent, '02 / 03');
  assert.match(g.node('result-progress').textContent, /DUNGEON · 1 \/ 3 floors cleared/);
  assert.equal(g.node('result-enemies').children[0].children[0].textContent, 'bat');
  assert.equal(g.node('result-enemies').children[0].children[1].textContent, '×2');
  g.listeners.get('replay-button:click')();
  assert.equal(g.game.running, true);
  assert.equal(g.game.gold, 0);
  assert.equal(g.game.summary.gear.size, 0);
  assert.equal(g.game.summary.enemies.size, 0);
  assert.equal(g.game.summary.clearedFloors.size, 0);
  assert.equal(g.frames.size, 1);
});

test('best gold persists across reloads, celebrates improvements, and survives replay', () => {
  const storage = new Map();
  let g = loadGame(storage);
  g.startGame(); g.game.gold = 100; g.endRun(false);
  assert.equal(storage.get('dungeon-drifter-best-gold'), '100');
  assert.equal(g.node('menu-best-gold').textContent, 100);
  assert.equal(g.node('result-record-label').textContent, 'New personal best!');
  g = loadGame(storage);
  assert.equal(g.node('menu-best-gold').textContent, 100);
  g.startGame(); g.game.gold = 80; g.endRun(false);
  assert.equal(g.node('result-best-gold').textContent, 100);
  assert.equal(g.node('result-record-label').textContent, 'Personal best');
  assert.equal(storage.get('dungeon-drifter-best-gold'), '100');
  g.startGame(); g.game.gold = 100; g.endRun(false);
  assert.equal(g.node('result-record-copy').textContent, 'You matched your best haul.');
  g.startGame(); g.game.gold = 125; g.endRun(true);
  assert.equal(storage.get('dungeon-drifter-best-gold'), '125');
  assert.equal(g.node('result-record-label').textContent, 'New personal best!');
  assert.match(g.node('result-record-copy').textContent, /25 gold above your previous best of 100/);
});

test('empty recaps, invalid records, unavailable storage, and ending a paused run are handled', () => {
  for (const value of ['invalid', '-10', 'Infinity', '1.5']) {
    const g = loadGame(new Map([['dungeon-drifter-best-gold', value]]));
    assert.equal(g.node('menu-best-gold').textContent, 0);
  }
  const g = loadGame(new Map(), true);
  g.startGame(); g.pauseGame(); g.game.gold = 20;
  g.listeners.get('pause-menu-button:click')();
  assert.equal(g.game.running, false);
  assert.equal(g.frames.size, 0);
  assert.equal(g.node('result-best-gold').textContent, 20);
  assert.equal(g.node('result-record-scope').textContent, 'this session');
  assert.equal(g.node('result-gear').children.length, 1);
  assert.match(g.node('result-gear').children[0].textContent, /No gear found/);
  assert.match(g.node('result-enemies').children[0].textContent, /No enemies defeated/);
  assert.match(g.node('result-copy').textContent, /You ended the run/);
  g.listeners.get('result-menu-button:click')();
  assert.equal(g.node('menu-best-gold').textContent, 20);
});

test('shadow draws dark terrain while hiding enemies and chests behind a wall', () => {
  const g = loadGame();
  g.startGame();
  g.game.map = Array.from({ length: 13 }, () => Array(15).fill('.'));
  g.game.mapWidth = 15; g.game.mapHeight = 13;
  for (const row of g.game.map) row[6] = '#';
  g.game.map[6][9] = '#';
  Object.assign(g.game.player, { x: 4.5, y: 6.5 });
  g.game.chests = [{ x: 5.5, y: 6.5 }, { x: 8.5, y: 6.5 }];
  g.game.enemies = [
    g.createEnemy({ kind: 'bat', hp: 20 }, 4.5, 5.5),
    g.createEnemy({ kind: 'bat', hp: 20 }, 8.5, 7.5)
  ];
  g.canvasCalls.length = 0;
  g.render();
  const { tile, ox, oy } = g.tileMetrics();
  const paintedAt = (x, y) => g.canvasCalls.filter((call) => call.method === 'fillRect' && call.args[0] === ox + x * tile && call.args[1] === oy + y * tile);
  for (const [x, y, color, shade] of [[8, 6, g.game.theme.palette.floor, 'rgba(0,0,0,.78)'], [9, 6, g.game.theme.palette.wall, 'rgba(0,0,0,.18)']]) {
    const fills = paintedAt(x, y);
    assert.ok(fills.some((call) => call.fillStyle === color), 'hidden terrain still has its base color');
    assert.ok(fills.some((call) => call.fillStyle === shade), 'floors are deeply shadowed; walls are only slightly darkened');
  }
  const drawnAt = (x, y) => g.canvasCalls.some((call) => call.method === 'translate' && call.args[0] === ox + x * tile && call.args[1] === oy + y * tile);
  assert.equal(drawnAt(5.5, 6.5), true, 'lit chest is drawn');
  assert.equal(drawnAt(4.5, 5.5), true, 'lit enemy is drawn');
  assert.equal(drawnAt(8.5, 6.5), false, 'shadowed chest stays hidden');
  assert.equal(drawnAt(8.5, 7.5), false, 'shadowed enemy stays hidden');
});

test('partly lit tiles do not reveal objects positioned in their shadowed portion', () => {
  const g = loadGame();
  g.startGame();
  g.game.map = Array.from({ length: 13 }, () => Array(15).fill('.'));
  g.game.mapWidth = 15; g.game.mapHeight = 13;
  for (let y = 6; y < 13; y++) g.game.map[y][6] = '#';
  Object.assign(g.game.player, { x: 4.5, y: 6.5 });
  g.game.rayCache = new Map();
  const tile = g.getCellVisibility(7, 5);
  assert.equal(tile.visible, true);
  assert.equal(tile.full, false);
  assert.equal(g.pointIsVisible(7.8, 5.1), true);
  assert.equal(g.pointIsVisible(7.8, 5.9), false);
});

test('each room corner brightens from either adjacent lit wall without revealing shadowed objects', () => {
  const g = loadGame();
  g.startGame();
  g.game.map = Array.from({ length: 15 }, () => Array(17).fill('#'));
  g.game.mapWidth = 17; g.game.mapHeight = 15;
  for (let y = 4; y <= 10; y++) for (let x = 4; x <= 10; x++) g.game.map[y][x] = '.';
  const corners = [
    [3, 3, [[4, 3], [3, 4]]], [11, 3, [[10, 3], [11, 4]]],
    [3, 11, [[4, 11], [3, 10]]], [11, 11, [[10, 11], [11, 10]]]
  ];
  for (const [x, y, neighbors] of corners) for (const [nx, ny] of neighbors) {
    // Isolate the visual corner rule from the raycaster's sampling positions.
    g.game.rayCache = new Map();
    for (let wy = 0; wy < 15; wy++) for (let wx = 0; wx < 17; wx++) {
      g.game.rayCache.set(`${wx},${wy}`, { visible: false, full: false, mask: [] });
    }
    assert.equal(g.wallIsBright(x, y, new Set()), false, 'an unlit corner stays shaded');
    g.game.rayCache.set(`${nx},${ny}`, { visible: true, full: true, mask: [] });
    assert.equal(g.wallIsBright(x, y, new Set()), true, `corner ${x},${y} lights from ${nx},${ny}`);
    assert.equal(g.getCellVisibility(x, y).visible, false, 'corner light does not alter the ray mask');
    assert.equal(g.pointIsVisible(4.5, 4.5), false, 'shadowed objects remain hidden');
    assert.equal(g.wallIsBright(6, 3, new Set()), false, 'light does not spread along a straight wall');
  }
});

test('render fills a ray-shadowed room corner brightly when a neighboring wall is lit', () => {
  const g = loadGame();
  g.startGame();
  g.game.map = Array.from({ length: 15 }, () => Array(17).fill('#'));
  g.game.mapWidth = 17; g.game.mapHeight = 15;
  for (let y = 4; y <= 10; y++) for (let x = 4; x <= 10; x++) g.game.map[y][x] = '.';
  Object.assign(g.game.player, { x: 7.2, y: 7.65 });
  g.game.chests = []; g.game.enemies = []; g.game.rayCache = new Map();
  assert.equal(g.getCellVisibility(3, 3).visible, false);
  assert.equal(g.wallIsBright(3, 3, new Set()), true);
  g.canvasCalls.length = 0;
  g.render();
  const { tile, ox, oy } = g.tileMetrics();
  const fills = g.canvasCalls.filter((call) => call.method === 'fillRect' && call.args[0] === ox + 3 * tile && call.args[1] === oy + 3 * tile);
  assert.ok(fills.some((call) => call.fillStyle === g.game.theme.palette.wall));
  assert.equal(fills.some((call) => call.fillStyle === 'rgba(0,0,0,.18)'), false);
});

test('generated maps separate unused void from the one-tile wall outline', () => {
  const g = loadGame();
  for (let seed = 0; seed < 10; seed++) for (let floor = 1; floor <= 3; floor++) {
    g.game.runSeed = seed;
    const { grid } = g.generateMap(floor);
    assert.ok(grid.some((row) => row.includes(' ')));
    for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
      const neighbors = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) neighbors.push(grid[y + dy]?.[x + dx]);
      }
      if (grid[y][x] === '#') assert.ok(neighbors.includes('.'), 'every wall borders a floor');
      if (grid[y][x] === ' ') assert.equal(neighbors.includes('.'), false, 'void cannot replace a room boundary');
    }
  }
});

test('void blocks movement and stays invisible even inside the player light radius', () => {
  const g = loadGame();
  g.startGame();
  g.game.map = [['#', '#', ' '], ['#', '.', ' '], ['#', '#', ' ']];
  g.game.mapWidth = 3; g.game.mapHeight = 3;
  Object.assign(g.game.player, { x: 1.5, y: 1.5 });
  g.game.rayCache = new Map();
  assert.equal(g.isWall(2.5, 1.5), true);
  assert.equal(g.canMove(2.5, 1.5), false);
  assert.equal(g.pointIsVisible(2.5, 1.5), false);
  assert.equal(g.canMove(1.5, 1.5), true);
});

test('void receives no tile borders and remains outside the combat flash drawing clip', () => {
  const g = loadGame();
  g.startGame();
  g.game.map = Array.from({ length: 7 }, () => Array(7).fill(' '));
  g.game.mapWidth = 7; g.game.mapHeight = 7;
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) g.game.map[y][x] = '#';
  g.game.map[3][3] = '.';
  Object.assign(g.game.player, { x: 3.5, y: 3.5 });
  g.game.chests = []; g.game.enemies = []; g.game.flash = .16; g.game.shake = .2;
  g.canvasCalls.length = 0;
  g.render();
  assert.equal(g.canvasCalls.find((call) => call.method === 'fillRect').fillStyle, '#000000');
  const { tile, ox, oy } = g.tileMetrics();
  const regions = g.canvasCalls.filter((call) => call.method === 'rect');
  assert.equal(regions.length, 3);
  regions.forEach((call, index) => assert.deepEqual(call.args, [ox + 2 * tile, oy + (index + 2) * tile, 3 * tile, tile]));
  assert.equal(g.canvasCalls.filter((call) => call.method === 'strokeRect').length, 1, 'only the floor has a tile border');
  const clipIndex = g.canvasCalls.findIndex((call) => call.method === 'clip');
  const flashIndex = g.canvasCalls.findIndex((call) => call.method === 'fillRect' && call.fillStyle.startsWith('rgba(255,'));
  assert.ok(flashIndex > clipIndex);
  assert.equal(g.canvasCalls.at(-1).method, 'restore', 'the terrain clip is retained through the flash');
});

test('unobstructed nearby diagonal floor tiles have no artificial shadow squares', () => {
  const g = loadGame();
  g.startGame();
  g.game.map = Array.from({ length: 9 }, () => Array(9).fill('.'));
  g.game.mapWidth = 9; g.game.mapHeight = 9;
  const positions = [4.05, 4.25, 4.5, 4.75, 4.95, 4 + 6.5 / 12];
  for (const x of positions) for (const y of positions) {
    Object.assign(g.game.player, { x, y });
    g.game.rayCache = new Map();
    for (let ty = 3; ty <= 5; ty++) for (let tx = 3; tx <= 5; tx++) {
      assert.equal(g.getCellVisibility(tx, ty).full, true, `player ${x},${y}, tile ${tx},${ty}`);
    }
  }
});

test('nearby walls cast real shadows instead of being overridden by player light', () => {
  const g = loadGame();
  g.startGame();
  g.game.map = Array.from({ length: 9 }, () => Array(9).fill('.'));
  g.game.mapWidth = 9; g.game.mapHeight = 9;
  g.game.map[4][5] = '#'; g.game.map[5][4] = '#';
  Object.assign(g.game.player, { x: 4.75, y: 4.75 });
  g.game.rayCache = new Map();
  assert.equal(g.pointIsVisible(5.25, 5.25), false, 'a sealed diagonal corner blocks sight within the old light radius');
  assert.equal(g.getCellVisibility(5, 5).visible, false);
});

test('grazing one nearby wall does not create a false diagonal shadow wedge', () => {
  const g = loadGame();
  g.startGame();
  g.game.map = Array.from({ length: 9 }, () => Array(9).fill('.'));
  g.game.mapWidth = 9; g.game.mapHeight = 9;
  g.game.map[4][5] = '#';
  Object.assign(g.game.player, { x: 4.75, y: 4.75 });
  g.game.rayCache = new Map();
  assert.equal(g.pointIsVisible(5.25, 5.25), true, 'a ray can graze one wall corner');
  assert.equal(g.pointIsVisible(5.7, 5.1), false, 'the same wall still blocks rays that cross its interior');
  assert.equal(g.getCellVisibility(5, 5).full, false, 'nearby partially blocked tiles are not automatically lit');
});
