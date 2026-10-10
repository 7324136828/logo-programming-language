import { TurtleGraphics, SpriteManager, VdpDisplay } from './graphics.js';
import { tokenize, TokenStream, tokensToSource } from './tokenizer.js';
import { LogoEnvironment, BUILTIN_VARIABLES, normalizeName } from './environment.js';
import { logoString, logoRepr, logoNumber, logoInt, logoBool, logoEquals, logoItems, logoCount, logoEmpty, listTokens, listItemTokens } from './values.js';

export { tokenize, LogoEnvironment, logoString, logoRepr };

// Lists are ordinary arrays. Original tokens preserve quoted words and nested code.
const precedence = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '+': 2, '-': 2, '*': 3, '/': 3 };
const aliases = {
  FD: 'FORWARD', BK: 'BACK', RT: 'RIGHT', LT: 'LEFT', PU: 'PENUP', PD: 'PENDOWN',
  CS: 'CLEARSCREEN', ST: 'SHOWTURTLE', HT: 'HIDETURTLE', NOTURTLE: 'HIDETURTLE',
  SXY: 'SETXY', SX: 'SETX', SY: 'SETY', SH: 'SETHEADING', CB: 'COLORBACKGROUND',
  SC: 'SETCOLOR', SETPENCOLOR: 'SETCOLOR', SS: 'SETSPEED', PT: 'PUTTILE', PC: 'PRINTCHAR',
  PR: 'PRINT', OP: 'OUTPUT', IFT: 'IFTRUE', IFF: 'IFFALSE', MS: 'MAKESHAPE',
};
const unaryPrimitives = new Set(['FIRST', 'F', 'BUTFIRST', 'BF', 'LAST', 'L', 'BUTLAST', 'BL', 'COUNT', 'EMPTY?',
  'NUMBER?', 'WORD?', 'LIST?', 'NOT', 'ABS', 'SQRT', 'SIN', 'COS', 'ROUND', 'INT']);
const binaryPrimitives = new Set(['SENTENCE', 'SE', 'WORD', 'LIST', 'FPUT', 'LPUT', 'ITEM', 'SUM',
  'DIFFERENCE', 'PRODUCT', 'QUOTIENT', 'REMAINDER', 'MODULO', 'BOTH', 'AND', 'EITHER', 'OR', 'EQUAL?', 'LESS?', 'GREATER?']);
const zeroPrimitives = new Set(['RANDOM', 'YOURNUMBER', 'YN', 'WHO', 'XCOR', 'YCOR', 'HEADING', 'COLOR',
  'TRUE', 'FALSE', 'FREEZE', 'RC', 'READCHAR', 'RC?', 'RL', 'READLIST', 'REPCOUNT', 'SHAPE', 'SPEED', 'XVEL', 'YVEL']);

class Flow extends Error {
  constructor(status, value = null, message = '') { super(message); this.status = status; this.value = value; }
}
class TailCall { constructor(args) { this.args = args; } }
class Jump { constructor(label) { this.label = normalizeName(label); } }
const ok = (value = null) => ({ status: 'ok', value, error: '' });
const nextTurn = delay => new Promise(resolve => setTimeout(resolve, delay));
const endOfLine = key => key === '\n' || key === '\r' || key === 'Enter';
const lineInputText = keys => {
  let text = '';
  for (const key of keys) {
    if (endOfLine(key)) break;
    if (key === '\b' || key === 'Backspace') text = text.slice(0, -1);
    else text += key;
  }
  return text;
};

/** A cooperative Logo runtime: no eval, native binary, or WebAssembly execution. */
export class LogoInterpreter {
  constructor({ turtle, sprites, display, onOutput, onYield, onEditShape, random = Math.random } = {}) {
    this.turtle = turtle || new TurtleGraphics();
    this.sprites = sprites || new SpriteManager();
    this.display = display || new VdpDisplay();
    this.environment = new LogoEnvironment();
    this.onOutput = onOutput;
    this.onYield = onYield;
    this.onEditShape = onEditShape;
    this.random = random;
    this.maxSteps = 1_000_000;
    this.maxCallDepth = 500;
    this.running = false;
    this.reset();
  }

  reset() {
    this.stop();
    this.environment.reset();
    this.turtle.reset(); this.sprites.reset(); this.display.reset();
    this.sprites.resetPatterns?.(); this.display.resetPatterns?.();
    this.output = []; this.inputQueue = [];
    this.stepCount = 0; this.callDepth = 0; this.frozen = false; this.waiting = false; this.waitingForInput = false; this._inputMode = null;
    this.selectedSprites = [0]; this.selectedTile = null; this.selectedBackground = false;
    this.explicitSpriteTarget = false;
    this.yourNumber = 0; this.characterCursor = 0; this.repeatCount = 0;
    this.editShape = null;
    this._procedureStack = [];
  }

  stop() { if (this._runContext) this._runContext.stopped = true; }
  get inputMode() { return this._inputMode; }
  get pendingInputText() { return this.inputMode === 'line' ? lineInputText(this.inputQueue) : ''; }
  tick(dt = 1 / 60) { if (!this.frozen) this.sprites.updateMotion(dt); }
  queueInputKey(key) { if (key != null) this.inputQueue.push(String(key)); }
  clearOutput() { this.output.length = 0; }

  print(text, newline = true) {
    text = logoString(text);
    if (newline || !this.output.length) this.output.push(text);
    else this.output[this.output.length - 1] += text;
    // Keep a busy animation from growing the console without bound.
    if (this.output.length > 1000) this.output.splice(0, this.output.length - 1000);
    if (newline) this.characterCursor = ((Math.floor(this.characterCursor / 32) + 1) * 32) % 768;
    this.onOutput?.(text, { newline, output: this.output });
  }

  _begin(source, options) {
    if (this.running) throw new Flow('error', null, 'A program is already running. Stop it before starting another.');
    this.stepCount = 0; this.callDepth = 0;
    this.environment.scopes.length = 0; this._procedureStack.length = 0;
    const requested = options.maxSteps ?? this.maxSteps;
    const maxSteps = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : this.maxSteps;
    const context = { stopped: false, async: false, maxSteps, signal: options.signal, interruptPoll: options.interruptPoll };
    const tokens = tokenize(source);
    this._runContext = context; this.running = true;
    return { context, generator: this._execute(new TokenStream(tokens), context) };
  }

  _result(error) {
    if (error instanceof Flow) return { status: error.status, value: error.value, error: error.message };
    if (error instanceof Jump) return { status: 'error', value: null, error: `Unknown label: ${error.label}` };
    if (error instanceof RangeError && /call stack/i.test(error.message)) return { status: 'error', value: null, error: 'Call stack overflow (infinite recursion)' };
    return { status: 'error', value: null, error: error?.message || String(error) };
  }

  _finish(context) {
    if (this._runContext === context) { this._runContext = null; this.running = false; }
    this.environment.scopes.length = 0; this._procedureStack.length = 0; this.callDepth = 0; this.waiting = false; this.waitingForInput = false; this._inputMode = null;
  }

  runSync(source, options = {}) {
    let execution;
    try {
      execution = this._begin(source, options);
      let item;
      do { item = execution.generator.next(); } while (!item.done);
      return ok(item.value);
    } catch (error) { return this._result(error); }
    finally { if (execution) { execution.generator.return(); this._finish(execution.context); } }
  }

  async run(source, options = {}) {
    let execution;
    try {
      execution = this._begin(source, options);
      execution.context.async = true;
      const batchSize = Math.max(1, Math.min(1000, options.yieldEvery ?? 250));
      let batch = 0;
      while (true) {
        const item = execution.generator.next();
        if (item.done) return ok(item.value);
        if (item.value?.delay != null || ++batch >= batchSize) {
          batch = 0;
          await this.onYield?.({ steps: this.stepCount, interpreter: this });
          await nextTurn(item.value?.delay || 0);
          this._check(execution.context);
        }
      }
    } catch (error) { return this._result(error); }
    finally { if (execution) { execution.generator.return(); this._finish(execution.context); } }
  }

  toSource({ includeVariables = true } = {}) {
    const definitions = [...this.environment.procedures.values()].map(proc =>
      `TO ${proc.name}${proc.parameters.length ? ' ' + proc.parameters.map(p => ':' + p).join(' ') : ''}\n${proc.rawSource}\nEND`);
    if (includeVariables) {
      const variables = [...this.environment.variables].filter(([key, value]) => !Object.hasOwn(BUILTIN_VARIABLES, key)
        || !logoEquals(value, BUILTIN_VARIABLES[key])).map(([key, value]) => `MAKE "${key} ${Array.isArray(value) ? `[${this._blockSource(value)}]` : logoRepr(value)}`);
      definitions.push(...variables);
    }
    return definitions.join('\n\n');
  }

  _check(context) {
    if (context.stopped || context.signal?.aborted || context.interruptPoll?.()) throw new Flow('interrupted', null, 'Execution interrupted');
  }

  *_step(context) {
    this._check(context);
    if (++this.stepCount > context.maxSteps) throw new Flow('step-limit', null, 'Maximum execution step budget exceeded');
    yield { steps: this.stepCount };
    this._check(context);
  }

  *_execute(stream, context) {
    let value = null;
    while (stream.hasMore) {
      if (stream.peek().type === 'newline') { stream.advance(); continue; }
      yield* this._step(context);
      if (stream.peek().type === 'word' && stream.peek().text.toUpperCase() === 'TO') this._define(stream);
      else {
        try { value = yield* this._statement(stream, context); }
        catch (error) {
          if (!(error instanceof Jump)) throw error;
          const labelIndex = stream.tokens.findIndex((token, i) => token.type === 'word' && normalizeName(token.text) === error.label
            && stream.tokens[i + 1]?.type === 'variable' && stream.tokens[i + 1].text === '');
          if (labelIndex < 0) throw error;
          stream.cursor = labelIndex + 2;
        }
      }
    }
    return value;
  }

  _define(stream) {
    stream.advance();
    const token = stream.advance();
    if (token.type !== 'word') throw new Error('Expected procedure name after TO');
    const name = normalizeName(token.text), parameters = [];
    while (stream.hasMore && stream.peek().type !== 'newline') {
      const param = stream.advance();
      if (!['variable', 'word'].includes(param.type)) throw new Error(`Invalid input name in TO ${name}`);
      parameters.push(normalizeName(param.text));
    }
    if (stream.peek().type === 'newline') stream.advance();
    const bodyTokens = [];
    let foundEnd = false, brackets = 0;
    while (stream.hasMore) {
      const next = stream.advance();
      if (next.type === '[') brackets++;
      if (next.type === ']') brackets--;
      if (brackets === 0 && next.type === 'word' && next.text.toUpperCase() === 'END') { foundEnd = true; break; }
      bodyTokens.push(next);
    }
    if (!foundEnd) throw new Error(`Missing END for procedure ${name}`);
    this.environment.defineProcedure({ name, parameters, bodyTokens, rawSource: tokensToSource(bodyTokens) });
  }

  *_statement(stream, context) {
    if (!stream.hasMore || stream.peek().type === 'newline') { stream.advance(); return null; }
    const token = stream.peek();
    if (token.type !== 'word') return yield* this._expression(stream, context);
    stream.advance();
    // Historical labels such as M: sit before commands on the same line.
    if (stream.peek().type === 'variable' && stream.peek().text === '') { stream.advance(); return null; }
    return yield* this._command(token.text.toUpperCase(), stream, context);
  }

  _error(message, stream) {
    const token = stream.peek();
    return new Error(`${message}${token.line ? ` (line ${token.line}, column ${token.column})` : ''}`);
  }

  *_input(stream, context, name) {
    if (!stream.hasMore || stream.peek().type === 'newline') throw this._error(`${name} needs an input`, stream);
    return yield* this._expression(stream, context);
  }

  *_command(rawName, stream, context) {
    const name = aliases[rawName] || rawName;
    const input = () => this._input(stream, context, name);
    let a, b, c;
    switch (name) {
      case 'STOP': throw new Flow('stopped');
      case 'OUTPUT': throw new Flow('output', yield* input());
      case 'FREEZE': this.frozen = true; return null;
      case 'THAW': this.frozen = false; return null;
      case 'MAKE': a = yield* input(); b = yield* input(); this.environment.setVariable(logoString(a), b); return null;
      case 'LOCAL': a = yield* input(); for (const key of logoItems(a)) this.environment.setLocalVariable(key, null); return null;
      case 'REPEAT': {
        a = Math.max(0, logoInt(yield* input())); b = yield* input();
        const previous = this.repeatCount;
        try { for (let i = 1; i <= a; i++) { yield* this._step(context); this.repeatCount = i; yield* this._block(b, context); } }
        finally { this.repeatCount = previous; }
        return null;
      }
      case 'FOREVER': a = yield* input(); while (true) { yield* this._step(context); yield* this._block(a, context); }
      case 'RUN': return yield* this._block(yield* input(), context);
      case 'GO': throw new Jump(yield* input());
      case 'LABEL': yield* input(); return null;
      case 'IF': case 'IFELSE': {
        const condition = logoBool(yield* input());
        if (stream.peek().type === '[' || name === 'IFELSE') {
          a = yield* input(); b = null;
          if (stream.peek().type === '[' || name === 'IFELSE') b = yield* input();
          if (condition) return yield* this._block(a, context);
          if (b != null) return yield* this._block(b, context);
        } else if (condition) return yield* this._statement(stream, context);
        else this._skipLine(stream);
        return null;
      }
      case 'TEST': this.environment.testFlag = logoBool(yield* input()); this.environment.hasTest = true; return null;
      case 'IFTRUE': case 'IFFALSE': {
        const condition = name === 'IFTRUE' ? this.environment.testFlag : !this.environment.testFlag;
        if (stream.peek().type === '[') { a = yield* input(); if (condition) return yield* this._block(a, context); }
        else if (condition) return yield* this._statement(stream, context);
        else this._skipLine(stream);
        return null;
      }
      case 'FORWARD': a = logoNumber(yield* input()); this.turtle.forward(a); if (this.explicitSpriteTarget) this.sprites.forward(a); return null;
      case 'BACK':
        if (!stream.hasMore || stream.peek().type === 'newline') throw new Error('BACK needs a distance (e.g. BACK 20). Press Escape to interrupt a procedure; use FREEZE to pause sprites.');
        a = logoNumber(yield* input()); this.turtle.back(a); if (this.explicitSpriteTarget) this.sprites.back(a); return null;
      case 'RIGHT': a = logoNumber(yield* input()); this.turtle.right(a); if (this.explicitSpriteTarget) this.sprites.right(a); return null;
      case 'LEFT': a = logoNumber(yield* input()); this.turtle.left(a); if (this.explicitSpriteTarget) this.sprites.left(a); return null;
      case 'PENUP': this.turtle.penUp(); return null;
      case 'PENDOWN': this.turtle.penDownCommand(); return null;
      case 'CLEARSCREEN': this.turtle.clearScreen(); this.display.clearTiles(); this.display.clearCharacters?.(); this.characterCursor = 0; return null;
      case 'CLEAR': case 'CLEAN': this.turtle.clearScreen(); this.display.clearTiles(); this.display.clearCharacters?.(); return null;
      case 'HOME': this.turtle.home(); if (this.explicitSpriteTarget) { this.sprites.setXY(0, 0); this.sprites.setHeading(0); } return null;
      case 'SHOWTURTLE': this.turtle.show(); return null;
      case 'HIDETURTLE': this.turtle.hide(); return null;
      case 'SETXY': a = logoNumber(yield* input()); b = logoNumber(yield* input()); this.turtle.setXY(a, b); this.sprites.setXY(a, b); return null;
      case 'SETX': a = logoNumber(yield* input()); this.turtle.setX(a); if (this.explicitSpriteTarget) this.sprites.setX(a); return null;
      case 'SETY': a = logoNumber(yield* input()); this.turtle.setY(a); if (this.explicitSpriteTarget) this.sprites.setY(a); return null;
      case 'SETHEADING': a = logoNumber(yield* input()); this.turtle.setHeading(a); this.sprites.setHeading(a); return null;
      case 'COLORBACKGROUND': this.display.setBackgroundColor(logoInt(yield* input())); return null;
      case 'SETCOLOR': {
        a = yield* input();
        if (this.selectedTile != null) this.display.setTileColor(this.selectedTile, a);
        else if (this.selectedBackground) this.display.setBackgroundColor(logoInt(a));
        else { this.turtle.setPenColor(logoInt(a)); this.sprites.setColor(logoInt(a)); }
        return null;
      }
      case 'DOT': {
        a = logoNumber(yield* input()); b = logoNumber(yield* input());
        this.turtle.addLine?.(a, b, a + 0.05, b + 0.05, this.turtle.color);
        return null;
      }
      case 'TELL': {
        this.selectedTile = null; this.selectedBackground = false;
        if (stream.peek().type === 'word' && stream.peek().text.toUpperCase() === 'TILE') {
          stream.advance(); this.selectedTile = logoInt(yield* input()); this.explicitSpriteTarget = false; return null;
        }
        if (stream.peek().type === 'word' && stream.peek().text.toUpperCase() === 'BACKGROUND') {
          stream.advance(); this.selectedBackground = true; this.explicitSpriteTarget = false; return null;
        }
        const targetToken = stream.peek();
        const turtleTarget = ['word', 'quoted', 'variable'].includes(targetToken.type) && targetToken.text.toUpperCase() === 'TURTLE';
        const whoTarget = targetToken.type === 'word' && targetToken.text.toUpperCase() === 'WHO';
        a = yield* input();
        this.explicitSpriteTarget = turtleTarget ? false : whoTarget ? this.explicitSpriteTarget : true;
        this.selectedSprites = Array.isArray(a) ? a.map(logoInt) : [typeof a === 'string' && a.toUpperCase() === 'TURTLE' ? 0 : logoInt(a)];
        this.sprites.tell(this.selectedSprites); return null;
      }
      case 'CARRY': this.sprites.setCarry(logoInt(yield* input())); return null;
      case 'SETSPEED': this.sprites.setSpeed(logoNumber(yield* input())); return null;
      case 'SETXVELOCITY': case 'SXV': this.sprites.setXVelocity(logoNumber(yield* input())); return null;
      case 'SETYVELOCITY': case 'SYV': this.sprites.setYVelocity(logoNumber(yield* input())); return null;
      case 'EACH': {
        a = yield* input(); const targets = [...this.selectedSprites]; const previous = this.yourNumber;
        try { for (const id of targets) { yield* this._step(context); this.yourNumber = id; this.sprites.tell(id); yield* this._block(a, context); } }
        finally { this.yourNumber = previous; this.sprites.tell(targets); }
        return null;
      }
      case 'PUTTILE': a = logoInt(yield* input()); b = logoInt(yield* input()); c = logoInt(yield* input()); this.display.putTile(a, b, c); return null;
      case 'PRINTCHAR': a = logoInt(yield* input()); this.display.putTile(a, this.characterCursor % 32, Math.floor(this.characterCursor / 32)); this.characterCursor = (this.characterCursor + 1) % 768; return null;
      case 'PRINT': this.print(!stream.hasMore || stream.peek().type === 'newline' ? '' : yield* input()); return null;
      case 'TYPE': this.print(yield* input(), false); return null;
      case 'WAIT': {
        a = Math.min(1000, Math.max(0, logoInt(yield* input())));
        this.waiting = true;
        try { for (let i = 0; i < a; i++) { yield* this._step(context); this.tick(0.016); yield { delay: 16 }; } }
        finally { this.waiting = false; }
        return null;
      }
      case 'CALL': {
        // TI Logo also supports CALL <value> "NAME as an assignment.
        a = yield* input(); b = yield* input(); this.environment.setVariable(logoString(b), a); return null;
      }
      case 'DEFINE': {
        a = normalizeName(yield* input()); b = yield* input();
        if (logoEmpty(b)) this.environment.eraseProcedure(a);
        else {
          const parts = logoItems(b), params = Array.isArray(parts[0]) ? parts[0].map(normalizeName) : [];
          const body = Array.isArray(parts[0]) ? parts.slice(1) : parts;
          const rawSource = body.map(v => Array.isArray(v) ? this._blockSource(v) : logoString(v)).join('\n');
          this.environment.defineProcedure({ name: a, parameters: params, bodyTokens: tokenize(rawSource), rawSource });
        }
        return null;
      }
      case 'MAKESHAPE': {
        this.editShape = logoInt(yield* input());
        if (this.onEditShape) this.onEditShape(this.editShape);
        else this.print(`Shape ${this.editShape} selected. Edit its 16 × 16 pattern in the shape editor.`);
        return null;
      }
      case 'DEFSHAPE': a = logoInt(yield* input()); b = yield* input(); this.sprites.defineShape(a, b); return null;
      case 'DEFCHAR': a = logoInt(yield* input()); b = yield* input(); this.display.setTilePattern(a, b); return null;
      case 'RECALL': return null;
      case 'SHOW': this.sprites.show(); return null;
      case 'HIDE': this.sprites.hide(); return null;
      default:
        if (this.environment.hasProcedure(name)) {
          const procedure = this.environment.getProcedure(name), args = [];
          for (const param of procedure.parameters) args.push(yield* this._input(stream, context, `${name} (${param})`));
          if (stream.procedure === name && this._isTail(stream)) throw new TailCall(args);
          return yield* this._procedure(procedure, args, context, false);
        }
        if (unaryPrimitives.has(name) || binaryPrimitives.has(name) || zeroPrimitives.has(name)) return yield* this._primitive(name, stream, context);
        throw this._error(`Unknown command or procedure: ${name}`, stream);
    }
  }

  _skipLine(stream) { while (stream.hasMore && stream.peek().type !== 'newline') stream.advance(); }
  _isTail(stream) { return stream.tokens.slice(stream.cursor).every(token => token.type === 'newline' || token.type === 'eof'); }

  *_procedure(procedure, initialArgs, context, expression) {
    if (++this.callDepth > this.maxCallDepth) { this.callDepth--; throw new Error('Call stack overflow (infinite recursion)'); }
    let args = initialArgs;
    this.environment.pushScope(); this._procedureStack.push(procedure);
    try {
      while (true) {
        this._check(context);
        for (let i = 0; i < procedure.parameters.length; i++) this.environment.setLocalVariable(procedure.parameters[i], args[i]);
        const stream = new TokenStream(procedure.bodyTokens); stream.procedure = procedure.name;
        try { return yield* this._execute(stream, context); }
        catch (error) {
          if (error instanceof TailCall) { args = error.args; yield* this._step(context); continue; }
          if (error instanceof Flow && error.status === 'stopped') return null;
          if (expression && error instanceof Flow && error.status === 'output') return error.value;
          throw error;
        }
      }
    } finally { this.environment.popScope(); this._procedureStack.pop(); this.callDepth--; }
  }

  _blockSource(value) {
    if (!Array.isArray(value)) return logoString(value);
    const tokens = listTokens.get(value);
    if (tokens) return tokensToSource(tokens);
    const items = listItemTokens.get(value);
    return value.map((item, i) => items?.[i] ? tokensToSource(items[i]) : Array.isArray(item) ? `[${this._blockSource(item)}]` : logoString(item)).join(' ');
  }

  *_block(value, context) {
    return yield* this._execute(new TokenStream(listTokens.get(value) || tokenize(this._blockSource(value))), context);
  }

  *_expression(stream, context, minimum = 1) {
    let value = yield* this._primary(stream, context);
    while (stream.hasMore && (precedence[stream.peek().type] || 0) >= minimum) {
      const op = stream.advance().type;
      const rhs = yield* this._expression(stream, context, precedence[op] + 1);
      switch (op) {
        case '+': value = logoNumber(value) + logoNumber(rhs); break;
        case '-': value = logoNumber(value) - logoNumber(rhs); break;
        case '*': value = logoNumber(value) * logoNumber(rhs); break;
        case '/': value = logoNumber(rhs) ? logoNumber(value) / logoNumber(rhs) : 0; break;
        case '=': value = logoEquals(value, rhs); break;
        case '<>': value = !logoEquals(value, rhs); break;
        case '<': value = logoNumber(value) < logoNumber(rhs); break;
        case '>': value = logoNumber(value) > logoNumber(rhs); break;
        case '<=': value = logoNumber(value) <= logoNumber(rhs); break;
        case '>=': value = logoNumber(value) >= logoNumber(rhs); break;
      }
    }
    return value;
  }

  *_primary(stream, context) {
    this._check(context);
    const token = stream.advance();
    switch (token.type) {
      case 'number': return token.value;
      case 'quoted': return token.text;
      case 'variable': return ['YOURNUMBER', 'YN'].includes(token.text.toUpperCase()) ? this.yourNumber : this.environment.getVariable(token.text);
      case '-': return -logoNumber(yield* this._primary(stream, context));
      case '+': return logoNumber(yield* this._primary(stream, context));
      case '[': return this._list(stream);
      case '(': {
        const value = yield* this._expression(stream, context);
        if (stream.peek().type !== ')') throw this._error('Expected closing parenthesis', stream);
        stream.advance(); return value;
      }
      case 'word': {
        const name = token.text.toUpperCase();
        if (unaryPrimitives.has(name) || binaryPrimitives.has(name) || zeroPrimitives.has(name)) return yield* this._primitive(name, stream, context);
        if (this.environment.hasProcedure(name)) {
          const procedure = this.environment.getProcedure(name), args = [];
          for (const param of procedure.parameters) args.push(yield* this._input(stream, context, `${name} (${param})`));
          return yield* this._procedure(procedure, args, context, true);
        }
        return token.text;
      }
      default: throw this._error(token.type === 'eof' ? 'Unexpected end of input while evaluating expression' : `Unexpected token: ${token.text}`, stream);
    }
  }

  _list(stream, depth = 0) {
    if (depth > 128) throw new Error('Maximum list nesting depth exceeded');
    const values = [], itemTokens = [], start = stream.cursor;
    while (stream.hasMore && stream.peek().type !== ']') {
      const itemStart = stream.cursor, token = stream.advance();
      if (token.type === 'newline') continue;
      if (token.type === '[') values.push(this._list(stream, depth + 1));
      else if (token.type === 'number') values.push(token.value);
      else if (token.type === 'variable') values.push(':' + token.text);
      else values.push(token.text);
      itemTokens.push(stream.tokens.slice(itemStart, stream.cursor));
    }
    if (stream.peek().type !== ']') throw this._error('Expected closing bracket', stream);
    listTokens.set(values, stream.tokens.slice(start, stream.cursor)); listItemTokens.set(values, itemTokens);
    stream.advance(); return values;
  }

  *_primitive(name, stream, context) {
    const input = () => this._input(stream, context, name);
    if (zeroPrimitives.has(name)) {
      switch (name) {
        case 'RANDOM': return Math.floor(Math.max(0, Math.min(0.999999999, this.random())) * 10);
        case 'YOURNUMBER': case 'YN': return this.yourNumber;
        case 'WHO': return this.selectedSprites.length === 1 ? this.selectedSprites[0] : [...this.selectedSprites];
        case 'XCOR': return this.turtle.x;
        case 'YCOR': return this.turtle.y;
        case 'HEADING': return this.turtle.heading;
        case 'COLOR': return this.turtle.color;
        case 'SHAPE': return this.sprites.getSprite(this.sprites.selected?.[0] ?? this.selectedSprites[0] ?? 0).shape;
        case 'SPEED': return this.sprites.getSprite(this.sprites.selected?.[0] ?? this.selectedSprites[0] ?? 0).speed;
        case 'XVEL': return this.sprites.getSprite(this.sprites.selected?.[0] ?? this.selectedSprites[0] ?? 0).vx ?? 0;
        case 'YVEL': return this.sprites.getSprite(this.sprites.selected?.[0] ?? this.selectedSprites[0] ?? 0).vy ?? 0;
        case 'TRUE': return true;
        case 'FALSE': return false;
        case 'FREEZE': return 'FREEZE';
        case 'REPCOUNT': return this.repeatCount;
        case 'RC?': return this.inputQueue.length > 0;
        case 'RC': case 'READCHAR': {
          this.waitingForInput = true; this._inputMode = 'key';
          try {
            while (context.async && !this.inputQueue.length) { this._check(context); yield { delay: 16 }; }
            return this.inputQueue.shift() || ' ';
          } finally { this.waitingForInput = false; this._inputMode = null; }
        }
        case 'RL': case 'READLIST': {
          this.waitingForInput = true; this._inputMode = 'line';
          try {
            // A browser key event arrives one character at a time. Wait for Enter
            // before consuming the buffer so TARGET receives a complete F 40 list.
            while (context.async && !this.inputQueue.some(endOfLine)) { this._check(context); yield { delay: 16 }; }
            let text = '', next;
            while ((next = this.inputQueue.shift()) != null && !endOfLine(next)) {
              if (next === '\b' || next === 'Backspace') text = text.slice(0, -1);
              else text += next;
            }
            return text.trim().split(/\s+/).filter(Boolean).map(word => Number.isFinite(Number(word)) ? Number(word) : word);
          } finally { this.waitingForInput = false; this._inputMode = null; }
        }
      }
    }
    const a = yield* input();
    if (unaryPrimitives.has(name)) {
      const array = Array.isArray(a), text = logoString(a);
      switch (name) {
        case 'FIRST': case 'F': return array ? a[0] ?? null : text[0] ?? null;
        case 'LAST': case 'L': return array ? a.at(-1) ?? null : text.at(-1) ?? null;
        case 'BUTFIRST': case 'BF': return array ? this._sliceList(a, 1) : text.slice(1);
        case 'BUTLAST': case 'BL': return array ? this._sliceList(a, 0, -1) : text.slice(0, -1);
        case 'COUNT': return logoCount(a);
        case 'EMPTY?': return logoEmpty(a);
        case 'NUMBER?': return typeof a === 'number' || typeof a === 'string' && a.trim() !== '' && Number.isFinite(Number(a));
        case 'WORD?': return typeof a === 'string' || typeof a === 'number';
        case 'LIST?': return array;
        case 'NOT': return !logoBool(a);
        case 'ABS': return Math.abs(logoNumber(a));
        case 'SQRT': return Math.sqrt(Math.max(0, logoNumber(a)));
        case 'SIN': return Math.sin(logoNumber(a) * Math.PI / 180);
        case 'COS': return Math.cos(logoNumber(a) * Math.PI / 180);
        case 'ROUND': return logoInt(a);
        case 'INT': return Math.trunc(logoNumber(a));
      }
    }
    const b = yield* input();
    switch (name) {
      case 'SENTENCE': case 'SE': return this._concatLists(a, b);
      case 'WORD': return logoString(a) + logoString(b);
      case 'LIST': return [a, b];
      case 'FPUT': return this._concatLists([a], b);
      case 'LPUT': return this._concatLists(b, [a]);
      case 'ITEM': return (Array.isArray(b) ? b : logoString(b))[logoInt(a) - 1] ?? null;
      case 'SUM': return logoNumber(a) + logoNumber(b);
      case 'DIFFERENCE': return logoNumber(a) - logoNumber(b);
      case 'PRODUCT': return logoNumber(a) * logoNumber(b);
      case 'QUOTIENT': return logoNumber(b) ? logoNumber(a) / logoNumber(b) : 0;
      case 'REMAINDER': return logoNumber(b) ? logoNumber(a) % logoNumber(b) : 0;
      case 'MODULO': return logoNumber(b) ? ((logoNumber(a) % logoNumber(b)) + logoNumber(b)) % logoNumber(b) : 0;
      case 'BOTH': case 'AND': return logoBool(a) && logoBool(b);
      case 'EITHER': case 'OR': return logoBool(a) || logoBool(b);
      case 'EQUAL?': return logoEquals(a, b);
      case 'LESS?': return logoNumber(a) < logoNumber(b);
      case 'GREATER?': return logoNumber(a) > logoNumber(b);
    }
    throw new Error(`Unknown primitive: ${name}`);
  }

  _sliceList(list, start, end) {
    const result = list.slice(start, end), tokens = listItemTokens.get(list);
    if (tokens) listItemTokens.set(result, tokens.slice(start, end));
    return result;
  }
  _concatLists(a, b) {
    const first = logoItems(a), second = logoItems(b), result = [...first, ...second];
    const metadata = value => listItemTokens.get(value) || logoItems(value).map(item => tokenize(Array.isArray(item) ? `[${this._blockSource(item)}]` : logoString(item)).filter(token => token.type !== 'eof'));
    listItemTokens.set(result, [...metadata(a), ...metadata(b)]);
    return result;
  }
}
