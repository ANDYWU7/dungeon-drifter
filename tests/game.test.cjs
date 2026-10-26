const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGame() {
  const nodes = new Map();
  const listeners = new Map();
  const frames = new Map();
  const timers = new Map();
  let nextId = 1;
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      style: {}, classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, querySelector() { return {}; },
      addEventListener(type, handler) { listeners.set(`${id}:${type}`, handler); },
      getBoundingClientRect() { return { width: 960, height: 540 }; },
      getContext() { return new Proxy({}, { get: () => () => {} }); }
    });
    return nodes.get(id);
  }
  const window = { devicePixelRatio: 1, addEventListener(type, handler) { listeners.set(`window:${type}`, handler); } };
  const document = {
    hidden: false, getElementById: node, querySelectorAll: () => [],
    addEventListener(type, handler) { listeners.set(`document:${type}`, handler); }
  };
  const context = vm.createContext({ window, document, console, performance: { now: () => 1000 },
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame(fn) { const id = nextId++; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn) { const id = nextId++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, `globalThis.api = { game, input, settings, startGame, pauseGame, resumeGame, returnToMenu, completeBoss, update, attack, dash, usePotion, generateMap, endRun, createEnemy, updateEnemy, drawEnemy }; })();`), context);
  return { ...context.api, frames, timers, listeners, document, node };
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

test('king detects outside his hitbox, winds up for 0.75 seconds, and commits after retreat', () => {
  const { g, king } = kingFight();
  g.updateEnemy(king, .016);
  assert.equal(king.kingWindup, .75);
  assert.equal(king.x, 10);
  g.drawEnemy(king, 32, 0, 0);
  g.game.player.x = 16;
  g.updateEnemy(king, .74);
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
  g.updateEnemy(king, .74);
  assert.equal(g.game.player.hp, 100);
  g.updateEnemy(king, .011);
  assert.equal(g.game.player.hp, 40);
  for (let i = 0; i < 24; i++) g.updateEnemy(king, .1);
  assert.equal(king.kingWindup, 0);
  assert.equal(g.game.player.hp, 40);
  g.updateEnemy(king, .11);
  assert.equal(king.kingWindup, .75);
  assert.equal(g.game.player.hp, 40);
});

test('king locks his aim so players can dodge behind the marked slash', () => {
  const { g, king } = kingFight();
  g.updateEnemy(king, .016);
  Object.assign(g.game.player, { x: 9, y: 11 });
  g.updateEnemy(king, .75);
  assert.equal(king.facingX, 1);
  assert.equal(king.facingY, 0);
  assert.equal(king.slash, .38);
  assert.equal(g.game.player.hp, 100);
  g.drawEnemy(king, 32, 0, 0);
});

test('king slash reaches 2.3 tiles across a full forward semicircle', () => {
  for (const [x, y, expectedHp] of [
    [12.2, 10, 40], // Increased reach in front.
    [10, 12.2, 40], // Both perpendicular edges are inside the 180-degree arc.
    [10, 7.8, 40],
    [9.9, 12.1, 100], // Behind the king remains safe.
    [12.4, 10, 100] // Outside the increased reach remains safe.
  ]) {
    const { g, king } = kingFight();
    g.updateEnemy(king, .016);
    Object.assign(g.game.player, { x, y });
    g.updateEnemy(king, .75);
    assert.equal(g.game.player.hp, expectedHp, `player at ${x}, ${y}`);
  }
});
