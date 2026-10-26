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

test('king detects outside his hitbox, visibly winds up for a full second, and commits after retreat', () => {
  const { g, king } = kingFight();
  g.updateEnemy(king, .016);
  assert.equal(king.kingWindup, 1);
  assert.equal(king.x, 10);
  g.drawEnemy(king, 32, 0, 0);
  g.game.player.x = 16;
  g.updateEnemy(king, .99);
  assert.ok(king.kingWindup > 0);
  assert.equal(king.slash, 0);
  g.updateEnemy(king, .011);
  assert.equal(king.kingWindup, 0);
  assert.equal(king.slash, .38);
  assert.equal(king.attackCooldown, 5);
  assert.equal(king.x, 10);
  assert.equal(g.game.player.hp, 100);
});

test('king hits once after windup, then waits five seconds before winding up again', () => {
  const { g, king } = kingFight();
  g.game.player.x = 11;
  g.updateEnemy(king, .016);
  assert.equal(g.game.player.hp, 100);
  g.updateEnemy(king, .99);
  assert.equal(g.game.player.hp, 100);
  g.updateEnemy(king, .011);
  assert.equal(g.game.player.hp, 40);
  for (let i = 0; i < 49; i++) g.updateEnemy(king, .1);
  assert.equal(king.kingWindup, 0);
  assert.equal(g.game.player.hp, 40);
  g.updateEnemy(king, .11);
  assert.equal(king.kingWindup, 1);
  assert.equal(g.game.player.hp, 40);
});

test('king locks his aim so players can sidestep the marked slash', () => {
  const { g, king } = kingFight();
  g.updateEnemy(king, .016);
  Object.assign(g.game.player, { x: 10, y: 11 });
  g.updateEnemy(king, 1);
  assert.equal(king.facingX, 1);
  assert.equal(king.facingY, 0);
  assert.equal(king.slash, .38);
  assert.equal(g.game.player.hp, 100);
  g.drawEnemy(king, 32, 0, 0);
});
