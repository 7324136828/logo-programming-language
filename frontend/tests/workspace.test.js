import test from 'node:test';
import assert from 'node:assert/strict';
import { LogoInterpreter } from '../src/core/interpreter.js';
import { SAMPLERS, findSampler, loadSampler } from '../src/data/samplers.js';
import {
  WORKSPACE_FORMAT, snapshotWorkspace, serializeWorkspace, deserializeWorkspace, exportLogoSource,
} from '../src/core/workspace.js';

test('all ten original sampler workspaces contain source and complete text pattern data', () => {
  assert.equal(SAMPLERS.length, 10);
  assert.equal(new Set(SAMPLERS.map(sampler => sampler.id)).size, 10);
  for (const sampler of SAMPLERS) {
    assert.match(sampler.source, /TO HELP\b/);
    assert.ok(sampler.commands.length > 0);
    assert.ok(sampler.source.includes(`TO ${sampler.previewCommand.split(' ')[0]}`));
    assert.equal(sampler.spritePatterns.length, sampler.hasGraphics ? 1024 : 0);
    assert.equal(sampler.characterPatterns.length, sampler.hasGraphics ? 2048 : 0);
    assert.ok([...sampler.spritePatterns, ...sampler.characterPatterns].every(value => Number.isInteger(value) && value >= 0 && value <= 255));
  }
  assert.equal(findSampler('a_frog')?.id, 'A_FROG');
  assert.equal(findSampler('unknown'), null);
});

test('every authentic sampler compiles and loads its variables and editable graphics', async () => {
  const interpreter = new LogoInterpreter();
  for (const sampler of SAMPLERS) {
    const result = await loadSampler(sampler.id, interpreter);
    assert.equal(result.id, sampler.id);
    assert.ok(interpreter.environment.procedures.size >= 4, sampler.id);
    assert.equal(interpreter.environment.getVariable('NORTH'), 0);
    assert.ok(interpreter.environment.hasProcedure(sampler.previewCommand.split(' ')[0]), sampler.id);
    assert.equal(interpreter.sprites.samplerId, sampler.id);
    if (sampler.hasGraphics) {
      assert.deepEqual(interpreter.sprites.getShapePattern(6), sampler.spritePatterns.slice(6 * 32, 7 * 32));
      assert.deepEqual(interpreter.display.getCharacterPattern(100), sampler.characterPatterns.slice(800, 808));
    }
  }
  await assert.rejects(loadSampler('missing', interpreter), /Unknown sampler/);
});

test('all ten suggested sampler activities execute without unknown-command errors', async () => {
  const interpreter = new LogoInterpreter({ random: () => 0.4 });
  for (const sampler of SAMPLERS) {
    await loadSampler(sampler.id, interpreter);
    const result = interpreter.runSync(sampler.previewCommand, { maxSteps: 5000 });
    // Interactive and endless examples are bounded here rather than waiting for a key.
    assert.ok(['ok', 'step-limit'].includes(result.status), `${sampler.id}: ${result.error}`);
  }
});

test('JSON workspace preserves definitions, nested variables, turtle drawing, sprites, tiles, and editor', async () => {
  const original = new LogoInterpreter();
  const result = await original.run('TO POLYGON :SIDES :LENGTH\nREPEAT :SIDES [FD :LENGTH RT 360 / :SIDES]\nEND\nMAKE "LABEL "GARDEN\nMAKE "VALUES [1 [2 3] TRUE]\nPOLYGON 5 16\nPU\nTELL 3 CARRY 4 SC 6 SXY 25 -30 SH 90 SS 2\nTELL TILE 100 SC [2 7] PT 100 2 3\nTELL TURTLE PU FD 12 RT 40 PD');
  assert.equal(result.status, 'ok', result.error);
  assert.equal(original.turtle.lines.length, 5);
  assert.equal(original.display.getTile(2, 3), 100);
  assert.equal(original.sprites.getSprite(3).speed, 2);
  original.sprites.setShapePattern(22, Array.from({ length: 32 }, (_, i) => i * 7 % 256));
  original.display.setCharacterPattern(100, [24, 60, 126, 255, 255, 126, 60, 24]);
  original.frozen = true;
  original.environment.testFlag = true;
  original.environment.hasTest = true;
  const options = { title: 'Garden', editorSource: 'POLYGON 5 16\nFD 999' };
  const before = snapshotWorkspace(original, options);
  const text = serializeWorkspace(original, options);
  assert.equal(JSON.parse(text).format, WORKSPACE_FORMAT);
  const restored = new LogoInterpreter();
  const metadata = await deserializeWorkspace(text, restored);
  assert.equal(metadata.title, options.title);
  assert.equal(metadata.editorSource, options.editorSource);
  assert.deepEqual(snapshotWorkspace(restored, options), before);
  await restored.run('POLYGON 3 12');
  assert.ok(restored.turtle.lines.length > before.graphics.turtle.lines.length);
});

test('Logo text exports global variables and imports executable procedures', async () => {
  const original = new LogoInterpreter();
  await original.run('TO WALK :N\nFD :N\nEND\nMAKE "DISTANCE 19\nMAKE "CHOICES [4 6 8]');
  const source = exportLogoSource(original);
  const restored = new LogoInterpreter();
  const metadata = await deserializeWorkspace(source, restored);
  assert.equal(metadata.format, 'logo-source');
  assert.deepEqual(restored.environment.getVariable('CHOICES'), [4, 6, 8]);
  await restored.run('WALK :DISTANCE');
  assert.equal(restored.turtle.y, 19);
});

test('JSON roundtrip preserves an executable list with quoted command arguments', async () => {
  const original = new LogoInterpreter();
  await original.run('MAKE "BLOCK [MAKE "ANSWER 42 MAKE "MESSAGE "HELLO]');
  const restored = new LogoInterpreter();
  await deserializeWorkspace(serializeWorkspace(original), restored);
  await restored.run('RUN :BLOCK');
  assert.equal(restored.environment.getVariable('ANSWER'), 42);
  assert.equal(restored.environment.getVariable('MESSAGE'), 'HELLO');
});

test('invalid JSON workspace is rejected before resetting the active drawing', async () => {
  const interpreter = new LogoInterpreter();
  await interpreter.run('FD 23');
  const before = interpreter.turtle.snapshot();
  await assert.rejects(deserializeWorkspace('{', interpreter), /JSON could not be read/);
  await assert.rejects(deserializeWorkspace({ format: WORKSPACE_FORMAT, version: 999 }, interpreter), /Unsupported workspace version/);
  await assert.rejects(deserializeWorkspace('FD 80\nUNRECOGNIZED', interpreter), /Logo import failed/);
  assert.deepEqual(interpreter.turtle.snapshot(), before);
});

test('malformed graphics and executable metadata cannot poison an existing workspace', async () => {
  const interpreter = new LogoInterpreter();
  await interpreter.run('TO WALK :N\nFD :N\nEND\nMAKE "ANSWER 7\nFD 23');
  const before = snapshotWorkspace(interpreter);
  const badStates = [
    workspace => { workspace.graphics.display.tiles = [100]; },
    workspace => { workspace.graphics.display.backgroundColor = 'red'; },
    workspace => { workspace.graphics.sprites.patterns[0][1].data[0] = 256; },
    workspace => { workspace.graphics.sprites.sprites[2].id = 1; },
    workspace => { workspace.graphics.sprites.sprites[0].x = 'NaN'; },
    workspace => { workspace.graphics.turtle.lines[0].y2 = Infinity; },
    workspace => { workspace.execution.selectedSprites = [99]; },
    workspace => { workspace.variables.push(['UNSAFE', { constructor: 'not a Logo value' }]); },
    workspace => { workspace.variables.push(['BLOCK', { $logoList: [42], tokens: [{ type: 'number', text: '42', value: 'bad' }] }]); },
    workspace => { Object.defineProperty(workspace.graphics.sprites.sprites[0], '__proto__', { enumerable: true, value: { polluted: true } }); },
  ];
  for (const makeBad of badStates) {
    const bad = JSON.parse(JSON.stringify(before));
    makeBad(bad);
    await assert.rejects(deserializeWorkspace(bad, interpreter), /invalid .* state/i);
    assert.deepEqual(snapshotWorkspace(interpreter), before);
  }
  assert.equal(Object.getPrototypeOf(interpreter.sprites.getSprite(0)), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test('JSON imports tokenize definitions without executing injected top-level commands', async () => {
  const interpreter = new LogoInterpreter();
  await interpreter.run('FD 23');
  const workspace = snapshotWorkspace(interpreter);
  workspace.procedures = [{ name: 'SAVED', parameters: [], rawSource: 'END\nMAKE "UNEXPECTED 1\nFD 999\nWAIT 1000' }];
  await deserializeWorkspace(workspace, interpreter);
  assert.equal(interpreter.environment.hasVariable('UNEXPECTED'), false);
  assert.deepEqual(interpreter.turtle.snapshot(), workspace.graphics.turtle);
  assert.equal(interpreter.environment.hasProcedure('SAVED'), true);
});

test('imported executable list metadata is detached from the input object', async () => {
  const original = new LogoInterpreter();
  await original.run('MAKE "BLOCK [MAKE "ANSWER 42]');
  const workspace = snapshotWorkspace(original);
  const restored = new LogoInterpreter();
  await deserializeWorkspace(workspace, restored);
  const block = workspace.variables.find(([name]) => name === 'BLOCK')[1];
  block.tokens.find(token => token.type === 'number').value = 99;
  await restored.run('RUN :BLOCK');
  assert.equal(restored.environment.getVariable('ANSWER'), 42);
});
