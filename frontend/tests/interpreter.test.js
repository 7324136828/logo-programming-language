import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LogoInterpreter, tokenize } from '../src/core/interpreter.js';
import { logoEquals, logoInt, serializeLogoValue, deserializeLogoValue } from '../src/core/values.js';
import { loadSampler } from '../src/data/samplers.js';

function execute(interpreter, source, options) {
  const result = interpreter.runSync(source, options);
  assert.equal(result.status, 'ok', result.error);
  return result;
}

test('tokenizer handles positions, operators, quoted words, comments and signed coordinates', () => {
  const tokens = tokenize('FORWARD 50 RIGHT 90 :X "WORD [1 2]\n; comment\nSETXY -33 -20\nMAKE "N :X-1');
  assert.deepEqual(tokens.slice(0, 7).map(t => t.type), ['word', 'number', 'word', 'number', 'variable', 'quoted', '[']);
  assert.equal(tokens[1].value, 50);
  assert.equal(tokens.find(t => t.text === 'SETXY').line, 3);
  assert.equal(tokens.find(t => t.text === '-33').value, -33);
  assert.equal(tokens.filter(t => t.type === '-').length, 1);
  assert.equal(logoInt(-1.5), -2);
  assert.equal(logoEquals('hello', 'HELLO'), true);
});

test('arithmetic precedence, comparison, variables and C++ zero-division semantics', () => {
  const i = new LogoInterpreter();
  execute(i, 'MAKE "RES 15 + 25 * 2\nMAKE "NEG (- 33)\nMAKE "CMP :RES >= 60\nMAKE "ZERO 10 / 0');
  assert.equal(i.environment.getVariable('res'), 65);
  assert.equal(i.environment.getVariable('NEG'), -33);
  assert.equal(i.environment.getVariable('CMP'), true);
  assert.equal(i.environment.getVariable('ZERO'), 0);
  assert.equal(i.environment.getVariable('BLUE'), 4);
});

test('repeat and nested blocks draw closed figures with pen and heading aliases', () => {
  const i = new LogoInterpreter();
  execute(i, 'CS SC 6 REPEAT 4 [FD 10 RT 90]');
  assert.equal(i.turtle.lines.length, 4);
  assert.ok(Math.abs(i.turtle.x) < 1e-9 && Math.abs(i.turtle.y) < 1e-9);
  execute(i, 'PU SXY -60 -40 PD REPEAT 2 [REPEAT 3 [FD 5 RT 120]]');
  assert.equal(i.turtle.lines.length, 10);
  execute(i, 'HT'); assert.equal(i.turtle.visible, false);
  execute(i, 'ST'); assert.equal(i.turtle.visible, true);
});

test('IF, TEST/IFT/IFF, single statements and optional else blocks', () => {
  const i = new LogoInterpreter();
  execute(i, 'MAKE "CHECK 0\nIF 10 > 5 [MAKE "CHECK 1] [MAKE "CHECK 2]\nTEST FALSE\nIFT MAKE "CHECK 3\nIFF MAKE "OTHER 4\nIF FALSE MAKE "CHECK 9\nPRINT :CHECK');
  assert.equal(i.environment.getVariable('CHECK'), 1);
  assert.equal(i.environment.getVariable('OTHER'), 4);
  assert.deepEqual(i.output, ['1']);
  execute(i, 'IFELSE FALSE [MAKE "CHECK 5] [MAKE "CHECK 6]');
  assert.equal(i.environment.getVariable('CHECK'), 6);
});

test('procedures, historical bare input names, recursive OUTPUT and dynamic local scope', () => {
  const i = new LogoInterpreter();
  execute(i, 'TO SQUARE SIDE\nREPEAT 4 [FD :SIDE RT 90]\nEND\nTO REC_SUM :N\nIF :N = 0 [OUTPUT 0]\nOUTPUT :N + REC_SUM :N - 1\nEND\nTO BUMP :N\nMAKE "N :N + 1\nOUTPUT :N\nEND');
  execute(i, 'CS SQUARE 20 MAKE "SUM_VAL REC_SUM 5 MAKE "N 100 MAKE "LOCAL_VAL BUMP 3');
  assert.equal(i.turtle.lines.length, 4);
  assert.equal(i.environment.getVariable('SUM_VAL'), 15);
  assert.equal(i.environment.getVariable('LOCAL_VAL'), 4);
  assert.equal(i.environment.getVariable('N'), 100);
  assert.equal(i.callDepth, 0);
  assert.equal(i.environment.scopes.length, 0);
});

test('list and word primitives preserve native values and quoted executable blocks', () => {
  const i = new LogoInterpreter();
  execute(i, 'MAKE "X [1 2 3]\nMAKE "F FIRST :X\nMAKE "L LAST :X\nMAKE "REST BF :X\nMAKE "ALL SE 10 [20 30]\nMAKE "WORD WORD "HEL "LO\nMAKE "BLOCK [MAKE "VALUE 42]\nRUN :BLOCK');
  assert.equal(i.environment.getVariable('F'), 1);
  assert.equal(i.environment.getVariable('L'), 3);
  assert.deepEqual(i.environment.getVariable('REST'), [2, 3]);
  assert.deepEqual(i.environment.getVariable('ALL'), [10, 20, 30]);
  assert.equal(i.environment.getVariable('WORD'), 'HELLO');
  assert.equal(i.environment.getVariable('VALUE'), 42);
  execute(i, 'MAKE "N COUNT [A [B C]] MAKE "EMPTY EMPTY? [] MAKE "NUM NUMBER? "42');
  assert.equal(i.environment.getVariable('N'), 2);
  assert.equal(i.environment.getVariable('EMPTY'), true);
  assert.equal(i.environment.getVariable('NUM'), true);
});

test('sprite selection, EACH/YOURNUMBER, color pairs, tiles and FREEZE/THAW', () => {
  const i = new LogoInterpreter({ random: () => 0.3 });
  execute(i, 'TELL [2 3] EACH [CARRY YN SC YN SH 90 SS RANDOM + 5] FREEZE');
  assert.equal(i.sprites.getSprite(2).shape, 2);
  assert.equal(i.sprites.getSprite(3).color, 3);
  assert.equal(i.sprites.getSprite(2).speed, 8);
  const x = i.sprites.getSprite(2).x;
  i.tick(1); assert.equal(i.sprites.getSprite(2).x, x);
  execute(i, 'THAW'); i.tick(1); assert.equal(i.sprites.getSprite(2).x, x + 8);
  execute(i, 'TELL TILE 100 SC [7 7] PT 100 5 5 CB 15');
  assert.equal(i.display.getTile(5, 5), 100);
  assert.equal(i.display.colors[100], 7);
  assert.equal(i.display.tileBackgrounds[100], 7);
  assert.equal(i.display.backgroundColor, 15);
  execute(i, 'CS REPEAT 12 [PRINT []] REPEAT 360 [PC 100]');
  assert.equal(i.display.getTile(0, 12), 100);
});

test('READCHAR/CALL input, legacy CALL assignments, TYPE and PRINT', () => {
  const i = new LogoInterpreter(); i.queueInputKey('Q');
  execute(i, 'CALL RC "KEY\nCALL 10 + 2 "TOTAL\nPRINT :KEY\nTYPE "HELLO\nPRINT :TOTAL');
  assert.equal(i.environment.getVariable('KEY'), 'Q');
  assert.equal(i.environment.getVariable('TOTAL'), 12);
  assert.deepEqual(i.output, ['QHELLO', '12']);
});

test('interactive READCHAR waits without burning a step budget and RC? detects queued input', async () => {
  const i = new LogoInterpreter();
  execute(i, 'MAKE "READY RC?'); assert.equal(i.environment.getVariable('READY'), false);
  const pending = i.run('CALL RC "KEY', { maxSteps: 5 });
  assert.equal(i.waitingForInput, true);
  assert.equal(i.inputMode, 'key');
  assert.equal(i.pendingInputText, '');
  assert.equal(i.stepCount, 1);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(i.running, true);
  assert.equal(i.stepCount, 1);
  i.queueInputKey('D');
  assert.equal((await pending).status, 'ok');
  assert.equal(i.environment.getVariable('KEY'), 'D');
  assert.equal(i.waitingForInput, false);
  assert.equal(i.inputMode, null);
  i.queueInputKey('Q'); execute(i, 'MAKE "READY RC?');
  assert.equal(i.environment.getVariable('READY'), true);
});

test('interactive READLIST waits for a complete line and Stop releases pending input', async () => {
  const i = new LogoInterpreter();
  const pending = i.run('CALL RL "LINE');
  for (const key of ['F', ' ', '4', '1', '\b', '0']) i.queueInputKey(key);
  assert.equal(i.inputMode, 'line');
  assert.equal(i.pendingInputText, 'F 40');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(i.environment.getVariable('LINE'), null);
  assert.equal(i.waitingForInput, true);
  i.queueInputKey('\r');
  assert.equal((await pending).status, 'ok');
  assert.deepEqual(i.environment.getVariable('LINE'), ['F', 40]);
  assert.equal(i.pendingInputText, '');
  assert.equal(i.inputMode, null);
  const stopped = i.run('CALL RL "NEVER'); i.stop();
  assert.equal((await stopped).status, 'interrupted');
  assert.equal(i.waitingForInput, false);
  assert.equal(i.inputMode, null);
  execute(i, 'FD 1');
});

test('explicit sprite targets move selected sprites and TELL TURTLE restores turtle movement', () => {
  const i = new LogoInterpreter();
  execute(i, 'PU TELL 3 SH 90 FD 8 TELL WHO SX 12 SY 20');
  assert.equal(i.sprites.getSprite(3).x, 12);
  assert.equal(i.sprites.getSprite(3).y, 20);
  assert.equal(i.explicitSpriteTarget, true);
  execute(i, 'TELL :TURTLE FD 5');
  assert.equal(i.explicitSpriteTarget, false);
  assert.equal(i.sprites.getSprite(3).x, 12);
  assert.equal(i.turtle.x, 17);
  execute(i, 'TELL [3 4] HOME RT 90 FD 2');
  assert.equal(i.sprites.getSprite(3).x, 2);
  assert.equal(i.sprites.getSprite(4).x, 2);
});

test('authentic Design and People keyboard activities move the selected shape and Q finishes', async () => {
  const i = new LogoInterpreter();
  await loadSampler('A_DESIGN', i); execute(i, 'PU HT GRID 20');
  const design = i.run('LISTEN');
  assert.equal(i.waitingForInput, true);
  i.queueInputKey('D'); i.queueInputKey('Q');
  assert.equal((await design).status, 'ok');
  assert.equal(i.sprites.getSprite(20).x, 48);
  assert.equal(i.sprites.getSprite(20).y, 40);
  await loadSampler('A_PEOPLE', i); execute(i, 'PU HT');
  const people = i.run('PEOPLE');
  assert.equal(i.waitingForInput, true);
  i.queueInputKey('E'); i.queueInputKey('Q');
  assert.equal((await people).status, 'ok');
  assert.equal(i.sprites.getSprite(24).y, 16);
  assert.equal(i.environment.getVariable('STOPFLAG'), 0);
});

test('the actual three UI starter examples produce distinct sprites and complete geometry', () => {
  const main = readFileSync(new URL('../src/data/examples.js', import.meta.url), 'utf8');
  const exampleSource = id => {
    const start = main.indexOf(`id: '${id}'`);
    assert.ok(start >= 0, `Missing ${id} example`);
    const match = main.slice(start).match(/source: `([\s\S]*?)`/);
    assert.ok(match, `Missing ${id} example source`);
    return match[1];
  };
  const i = new LogoInterpreter();
  execute(i, exampleSource('bloom'));
  assert.equal(i.turtle.lines.length, 2340);
  assert.equal(i.turtle.visible, false);
  i.reset(); execute(i, exampleSource('kinetic'));
  assert.deepEqual(i.sprites.sprites.slice(0, 6).map(s => s.shape), [1, 2, 3, 4, 5, 1]);
  assert.deepEqual(i.sprites.sprites.slice(0, 6).map(s => s.x), [-90, -54, -18, 18, 54, 90]);
  assert.deepEqual(i.sprites.sprites.slice(0, 6).map(s => s.heading), [0, 60, 120, 180, 240, 300]);
  i.reset(); execute(i, exampleSource('tree'));
  assert.equal(i.turtle.lines.length, 254);
  assert.ok(Math.abs(i.turtle.x) < 1e-9);
  assert.ok(Math.abs(i.turtle.y + 74) < 1e-9);
});

test('historical labels and GO execute bounded loops and recover from missing labels', () => {
  const i = new LogoInterpreter();
  execute(i, 'TO COUNTDOWN :N\nAGAIN: MAKE "N :N - 1\nIF :N = 0 [OUTPUT 99]\nGO "AGAIN\nEND\nMAKE "RESULT COUNTDOWN 4');
  assert.equal(i.environment.getVariable('RESULT'), 99);
  assert.equal(i.runSync('GO "MISSING').status, 'error');
  execute(i, 'MAKE "READY 1');
});

test('historical shape editor requests and editable byte patterns use JavaScript models', () => {
  let shape;
  const i = new LogoInterpreter({ onEditShape: id => { shape = id; } });
  execute(i, 'MS 20\nDEFCHAR 100 [24 60 126 255 255 126 60 24]');
  assert.equal(shape, 20);
  assert.deepEqual(i.display.getCharacterPattern(100), [24, 60, 126, 255, 255, 126, 60, 24]);
  execute(i, 'TELL 18 CARRY 16 CARRY 33 - SHAPE');
  assert.equal(i.sprites.getSprite(18).shape, 17);
  execute(i, 'TELL 18 SH 90 SS 0 SXV 20 SYV -10');
  i.tick(1);
  assert.equal(i.sprites.getSprite(18).x, 20);
  assert.equal(i.sprites.getSprite(18).y, -10);
  execute(i, 'SYV 0'); i.tick(1);
  assert.equal(i.sprites.getSprite(18).x, 40);
  assert.equal(i.sprites.getSprite(18).y, -10);
});

test('errors and step limits recover cleanly for the next command', () => {
  const i = new LogoInterpreter();
  assert.equal(i.runSync('BACK').status, 'error');
  assert.match(i.runSync('BACK').error, /distance/);
  assert.equal(i.runSync('REPEAT 10 [FD 1]', { maxSteps: 3 }).status, 'step-limit');
  execute(i, 'FD 1', { maxSteps: 3 });
  assert.equal(i.runSync('REPEAT 999999999 []', { maxSteps: 8 }).status, 'step-limit');
  assert.equal(i.runSync('FOREVER []', { maxSteps: 8 }).status, 'step-limit');
  execute(i, 'TO LOOP\nLOOP\nEND');
  assert.equal(i.runSync('LOOP', { maxSteps: 8 }).status, 'step-limit');
  assert.equal(i.runSync('REPEAT 1 [FD 1').status, 'error');
  assert.equal(i.runSync('TO BROKEN\nFD 1').status, 'error');
  assert.equal(i.runSync('BOGUS').status, 'error');
  execute(i, 'TO CRASH :N\nMAKE "TEMP CRASH :N + 1\nEND');
  const recursion = i.runSync('CRASH 0');
  assert.equal(recursion.status, 'error');
  assert.match(recursion.error, /Call stack overflow/);
  assert.equal(i.environment.scopes.length, 0);
  assert.equal(i.callDepth, 0);
  execute(i, 'MAKE "READY 1'); assert.equal(i.environment.getVariable('READY'), 1);
});

test('cooperative interrupt of a malicious empty loop and subsequent recovery', async () => {
  const i = new LogoInterpreter();
  const pending = i.run('REPEAT 999999999 []', { maxSteps: 1_000_000_000 });
  setTimeout(() => i.stop(), 5);
  const result = await pending;
  assert.equal(result.status, 'interrupted');
  assert.ok(i.stepCount < 1_000_000_000);
  assert.equal(i.running, false);
  assert.equal((await i.run('MAKE "READY 1')).status, 'ok');
  assert.equal(i.environment.getVariable('READY'), 1);
});

test('self tail recursion runs without stack growth and can be interrupted', async () => {
  const i = new LogoInterpreter();
  execute(i, 'TO ANIMATE :N\nMAKE "FRAME :N\nANIMATE :N + 1\nEND');
  const result = await i.run('ANIMATE 0', { interruptPoll: () => i.stepCount > 4000 });
  assert.equal(result.status, 'interrupted');
  assert.ok(i.environment.getVariable('FRAME') > 1000);
  assert.equal(i.callDepth, 0);
  assert.equal(i.environment.scopes.length, 0);
});

test('async WAIT yields to Stop and sync WAIT advances the same simulation', async () => {
  const i = new LogoInterpreter();
  execute(i, 'TELL 2 CARRY 4 SH 90 SS 10 WAIT 10');
  assert.ok(Math.abs(i.sprites.getSprite(2).x - 1.6) < 1e-9);
  const pending = i.run('WAIT 1000'); setTimeout(() => i.stop(), 5);
  assert.equal((await pending).status, 'interrupted');
});

test('source export and JSON list snapshots preserve executable quoting', () => {
  const i = new LogoInterpreter();
  execute(i, 'TO SQUARE :SIDE\nREPEAT 4 [FD :SIDE RT 90]\nEND\nMAKE "BLOCK [MAKE "HELLO "WORLD]\nMAKE "SHAPES [1 2 3]');
  const source = i.toSource(), restored = new LogoInterpreter();
  execute(restored, source); execute(restored, 'RUN :BLOCK');
  assert.equal(restored.environment.getVariable('HELLO'), 'WORLD');
  const json = JSON.stringify(serializeLogoValue(i.environment.getVariable('BLOCK')));
  restored.environment.setVariable('ROUNDTRIP', deserializeLogoValue(JSON.parse(json)));
  execute(restored, 'RUN :ROUNDTRIP'); assert.equal(restored.environment.getVariable('HELLO'), 'WORLD');
});
