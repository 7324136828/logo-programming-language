import { logoRepr, serializeLogoValue, deserializeLogoValue } from './values.js';
import { tokenize } from './tokenizer.js';

export const WORKSPACE_FORMAT = 'ti-logo-web-workspace';
export const WORKSPACE_VERSION = 1;

const copy = value => JSON.parse(JSON.stringify(value));
const procedureSource = procedure => `TO ${procedure.name}${procedure.parameters.length ? ' ' + procedure.parameters.map(name => ':' + name).join(' ') : ''}\n${procedure.rawSource ?? ''}\nEND`;
const requireSuccess = result => {
  if (result.status !== 'ok') throw new Error(`Logo import failed: ${result.error || result.status}`);
};

const executionSnapshot = interpreter => ({
  selectedSprites: copy(interpreter.selectedSprites ?? []),
  selectedTile: interpreter.selectedTile ?? null,
  selectedBackground: Boolean(interpreter.selectedBackground),
  explicitSpriteTarget: Boolean(interpreter.explicitSpriteTarget),
  characterCursor: interpreter.characterCursor ?? 0,
  frozen: Boolean(interpreter.frozen),
  testFlag: Boolean(interpreter.environment.testFlag),
  hasTest: Boolean(interpreter.environment.hasTest),
});

function restoreExecution(interpreter, execution = {}) {
  interpreter.selectedSprites = copy(execution.selectedSprites ?? []);
  interpreter.selectedTile = execution.selectedTile ?? null;
  interpreter.selectedBackground = Boolean(execution.selectedBackground);
  interpreter.explicitSpriteTarget = Boolean(execution.explicitSpriteTarget);
  interpreter.characterCursor = execution.characterCursor ?? 0;
  interpreter.frozen = Boolean(execution.frozen);
  interpreter.environment.testFlag = Boolean(execution.testFlag);
  interpreter.environment.hasTest = Boolean(execution.hasTest);
}

async function preserveOnFailure(interpreter, operation) {
  const previous = {
    variables: new Map(interpreter.environment.variables),
    procedures: new Map(interpreter.environment.procedures),
    turtle: interpreter.turtle.snapshot(),
    sprites: interpreter.sprites.snapshot(),
    display: interpreter.display.snapshot(),
    execution: executionSnapshot(interpreter),
    output: [...interpreter.output],
    inputQueue: [...interpreter.inputQueue],
  };
  try { return await operation(); }
  catch (error) {
    interpreter.reset();
    interpreter.environment.variables = previous.variables;
    interpreter.environment.procedures = previous.procedures;
    interpreter.turtle.restore(previous.turtle);
    interpreter.sprites.restore(previous.sprites);
    interpreter.display.restore(previous.display);
    restoreExecution(interpreter, previous.execution);
    interpreter.output = previous.output;
    interpreter.inputQueue = previous.inputQueue;
    throw error;
  }
}

/** Portable Logo text includes both procedures and global variable values. */
export function exportLogoSource(interpreter) {
  if (typeof interpreter.toSource === 'function') return interpreter.toSource({ includeVariables: true });
  const definitions = [...interpreter.environment.procedures.values()].map(procedureSource);
  const variables = [...interpreter.environment.variables].map(([name, value]) => `MAKE "${name} ${logoRepr(value)}`);
  return [...definitions, ...variables].join('\n\n') + '\n';
}

/** JSON is the complete workspace format; Logo text alone cannot hold graphics. */
export function snapshotWorkspace(interpreter, { editorSource = '', title = 'Untitled workspace' } = {}) {
  const env = interpreter.environment;
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    title: String(title),
    editorSource: String(editorSource),
    source: exportLogoSource(interpreter),
    variables: [...env.variables].map(([name, value]) => [name, serializeLogoValue(value)]),
    procedures: [...env.procedures.values()].map(({ name, parameters, rawSource }) => ({
      name, parameters: [...parameters], rawSource: rawSource ?? '',
    })),
    graphics: {
      turtle: interpreter.turtle.snapshot(),
      sprites: interpreter.sprites.snapshot(),
      display: interpreter.display.snapshot(),
    },
    execution: executionSnapshot(interpreter),
  };
}

export function serializeWorkspace(interpreter, options = {}) {
  return JSON.stringify(snapshotWorkspace(interpreter, options), null, 2);
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const isInteger = value => isFiniteNumber(value) && Number.isInteger(value);
const isId = (value, count) => isInteger(value) && value >= 0 && value < count;
const isColor = value => isId(value, 16);
const isBoolean = value => typeof value === 'boolean';
const isNullableText = value => value === null || typeof value === 'string';
const isNullableNumber = value => value === null || isFiniteNumber(value);
const isArrayOf = (value, test, length = null) => Array.isArray(value)
  && (length === null || value.length === length) && value.every(test);

function requireState(valid, field) {
  if (!valid) throw new Error(`Workspace has invalid ${field} state.`);
}

function requireKeys(record, fields, label) {
  requireState(isRecord(record) && Object.keys(record).every(key => fields.includes(key)), label);
}

function validateGraphics(graphics) {
  const { turtle, sprites, display } = graphics;
  requireKeys(turtle, ['x', 'y', 'heading', 'penDown', 'visible', 'color', 'lines'], 'turtle');
  requireState(['x', 'y', 'heading'].every(key => isFiniteNumber(turtle[key]))
    && isBoolean(turtle.penDown) && isBoolean(turtle.visible) && isColor(turtle.color)
    && Array.isArray(turtle.lines), 'turtle');
  for (const line of turtle.lines) {
    requireKeys(line, ['x1', 'y1', 'x2', 'y2', 'color'], 'turtle line');
    requireState(['x1', 'y1', 'x2', 'y2'].every(key => isFiniteNumber(line[key])) && isColor(line.color), 'turtle line');
  }

  requireKeys(sprites, ['sprites', 'selected', 'samplerId', 'patterns'], 'sprite graphics');
  requireState(Array.isArray(sprites.sprites) && sprites.sprites.length === 32
    && isArrayOf(sprites.selected, id => isId(id, 32)) && isNullableText(sprites.samplerId), 'sprite graphics');
  const spriteIds = new Set();
  for (const sprite of sprites.sprites) {
    requireKeys(sprite, ['id', 'x', 'y', 'heading', 'speed', 'vx', 'vy', 'color', 'shape', 'visible'], 'sprite');
    requireState(isId(sprite.id, 32) && !spriteIds.has(sprite.id)
      && ['x', 'y', 'heading', 'speed'].every(key => isFiniteNumber(sprite[key]))
      && (sprite.vx === undefined || isNullableNumber(sprite.vx)) && (sprite.vy === undefined || isNullableNumber(sprite.vy))
      && isInteger(sprite.shape) && isColor(sprite.color) && isBoolean(sprite.visible), 'sprite');
    spriteIds.add(sprite.id);
  }
  validatePatterns(sprites.patterns, 32, true);

  requireKeys(display, ['backgroundColor', 'backgroundExplicit', 'samplerId', 'characterCursor', 'tiles', 'colors', 'tileBackgrounds', 'patterns'], 'display graphics');
  requireState(isColor(display.backgroundColor) && isBoolean(display.backgroundExplicit)
    && isNullableText(display.samplerId) && isId(display.characterCursor, 768)
    && isArrayOf(display.tiles, value => isId(value, 256), 768)
    && isArrayOf(display.colors, isColor, 256) && isArrayOf(display.tileBackgrounds, isColor, 256), 'display graphics');
  validatePatterns(display.patterns, 8, false);
}

function validatePatterns(patterns, width, spritePatterns) {
  requireState(Array.isArray(patterns), 'pattern');
  const ids = new Set();
  for (const entry of patterns) {
    requireState(Array.isArray(entry) && entry.length === 2 && isId(entry[0], 256) && !ids.has(entry[0]), 'pattern');
    ids.add(entry[0]);
    if (spritePatterns) requireKeys(entry[1], ['custom', 'data'], 'sprite pattern');
    requireState((!spritePatterns || isBoolean(entry[1].custom))
      && isArrayOf(spritePatterns ? entry[1].data : entry[1], value => isId(value, 256), width), 'pattern');
  }
}

const tokenTypes = new Set(['number', 'quoted', 'variable', 'word', 'newline', 'eof', '[', ']', '(', ')', '+', '-', '*', '/', '=', '<', '>', '<=', '>=', '<>']);
function validateTokens(tokens) {
  requireState(Array.isArray(tokens), 'executable list token');
  for (const token of tokens) {
    requireKeys(token, ['type', 'text', 'value', 'line', 'column', 'offset'], 'executable list token');
    requireState(tokenTypes.has(token.type) && typeof token.text === 'string'
      && (token.type !== 'number' || isFiniteNumber(token.value))
      && (token.line === undefined || isInteger(token.line) && token.line > 0)
      && (token.column === undefined || isInteger(token.column) && token.column > 0)
      && (token.offset === undefined || isInteger(token.offset) && token.offset >= 0), 'executable list token');
  }
}

function validateLogoValue(value, depth = 0) {
  requireState(depth <= 128, 'list nesting (maximum 128 levels)');
  if (value === null || typeof value === 'string' || isBoolean(value) || isFiniteNumber(value)) return;
  if (Array.isArray(value)) { value.forEach(item => validateLogoValue(item, depth + 1)); return; }
  requireKeys(value, ['$logoList', 'tokens', 'itemTokens'], 'Logo value');
  requireState(Array.isArray(value.$logoList), 'Logo list');
  value.$logoList.forEach(item => validateLogoValue(item, depth + 1));
  if (value.tokens !== undefined) validateTokens(value.tokens);
  if (value.itemTokens !== undefined) {
    requireState(Array.isArray(value.itemTokens) && value.itemTokens.length === value.$logoList.length, 'executable list item');
    value.itemTokens.forEach(validateTokens);
  }
}

function validateWorkspace(workspace) {
  if (!workspace || typeof workspace !== 'object' || workspace.format !== WORKSPACE_FORMAT) {
    throw new Error('This is not a TI Logo web workspace. Import a .logo source file or a .json workspace.');
  }
  if (workspace.version !== WORKSPACE_VERSION) throw new Error(`Unsupported workspace version: ${workspace.version}`);
  if (!Array.isArray(workspace.procedures) || !Array.isArray(workspace.variables)
      || !workspace.graphics?.turtle || !workspace.graphics?.sprites || !workspace.graphics?.display) {
    throw new Error('Workspace is missing procedures, variables, or graphics state.');
  }
  const validName = name => typeof name === 'string' && name.length > 0 && !/[\s\[\]():";]/.test(name);
  for (const procedure of workspace.procedures) {
    requireKeys(procedure, ['name', 'parameters', 'rawSource'], 'procedure');
    if (!validName(procedure?.name) || !Array.isArray(procedure.parameters)
        || procedure.parameters.some(name => !validName(name)) || typeof procedure.rawSource !== 'string') {
      throw new Error('Workspace has an invalid procedure definition.');
    }
  }
  for (const variable of workspace.variables) {
    if (!Array.isArray(variable) || variable.length !== 2 || !validName(variable[0])) {
      throw new Error('Workspace has an invalid variable.');
    }
    validateLogoValue(variable[1]);
  }
  validateGraphics(workspace.graphics);
  if (workspace.execution !== undefined) {
    const execution = workspace.execution;
    requireKeys(execution, ['selectedSprites', 'selectedTile', 'selectedBackground', 'explicitSpriteTarget', 'characterCursor', 'frozen', 'testFlag', 'hasTest'], 'execution');
    requireState(isArrayOf(execution.selectedSprites, id => isId(id, 32))
      && (execution.selectedTile === null || isId(execution.selectedTile, 256))
      && isId(execution.characterCursor, 768)
      && ['selectedBackground', 'frozen', 'testFlag', 'hasTest'].every(key => isBoolean(execution[key]))
      && (execution.explicitSpriteTarget === undefined || isBoolean(execution.explicitSpriteTarget)), 'execution');
  }
  for (const field of ['title', 'editorSource', 'source']) requireState(workspace[field] === undefined || typeof workspace[field] === 'string', field);
  return workspace;
}

/** Imports readable JSON snapshots or executes an ordinary Logo source file. */
export async function deserializeWorkspace(input, interpreter) {
  if (interpreter.running) throw new Error('Stop the current program before importing a workspace.');
  let workspace = input;
  if (typeof input === 'string') {
    const text = input.replace(/^\uFEFF/, '');
    if (!text.trim().startsWith('{')) {
      return preserveOnFailure(interpreter, async () => {
        interpreter.reset();
        requireSuccess(await interpreter.run(text));
        return { format: 'logo-source', editorSource: text, title: 'Imported Logo source' };
      });
    }
    try { workspace = JSON.parse(text); }
    catch { throw new Error('Workspace JSON could not be read. Check that the file is complete.'); }
  }
  // Detach imported metadata and executable lists from a caller-owned object.
  workspace = validateWorkspace(copy(workspace));
  return preserveOnFailure(interpreter, async () => {
    interpreter.reset();
    // Tokenize bodies directly. Even an END in imported text cannot execute a
    // top-level command during a JSON import or launch a saved animation.
    for (const procedure of workspace.procedures) {
      interpreter.environment.defineProcedure({ ...procedure, name: procedure.name.toUpperCase(),
        parameters: procedure.parameters.map(name => name.toUpperCase()), bodyTokens: tokenize(procedure.rawSource) });
    }
    interpreter.environment.variables = new Map(workspace.variables.map(([name, value]) => [name.toUpperCase(), deserializeLogoValue(value)]));
    interpreter.turtle.restore(workspace.graphics.turtle);
    interpreter.sprites.restore(workspace.graphics.sprites);
    interpreter.display.restore(workspace.graphics.display);
    restoreExecution(interpreter, workspace.execution);
    return {
      format: WORKSPACE_FORMAT,
      title: workspace.title || 'Imported workspace',
      editorSource: workspace.editorSource ?? workspace.source ?? '',
    };
  });
}
