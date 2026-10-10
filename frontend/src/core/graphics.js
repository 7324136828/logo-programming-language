/** Logo coordinates remain independent of browser pixels and the renderer. */
export const WIDTH = 256;
export const HEIGHT = 192;
export const PALETTE = Object.freeze([
  '#000000', '#000000', '#21c842', '#5edc78', '#5455ed', '#7d76fc',
  '#d4524d', '#42ebf5', '#fc5554', '#ff7978', '#d4c154', '#e6ce80',
  '#21b03b', '#c95bba', '#cccccc', '#ffffff',
]);
const angle = (degrees) => ((Number(degrees) % 360) + 360) % 360;
const validColor = (color) => Number.isInteger(color) && color >= 0 && color < 16;
const validId = (id, count = 256) => Number.isInteger(id) && id >= 0 && id < count;
function bytes(pattern, count) {
  if (typeof pattern === 'string') {
    const text = pattern.replace(/\s/g, '');
    if (/^[01]+$/.test(text) && text.length === count * 8) return Array.from({ length: count }, (_, i) => parseInt(text.slice(i * 8, i * 8 + 8), 2));
    if (/^[\da-f]+$/i.test(text) && text.length === count * 2) return Array.from({ length: count }, (_, i) => parseInt(text.slice(i * 2, i * 2 + 2), 16));
    throw new Error(`Pattern requires ${count} bytes, ${count * 8} bits, or ${count * 2} hexadecimal digits.`);
  }
  if (!pattern || pattern.length !== count || Array.from(pattern).some((n) => !validId(Number(n)))) throw new Error(`Pattern requires a list of ${count} byte values (0–255).`);
  return Array.from(pattern, Number);
}

export class TurtleGraphics {
  constructor() { this.reset(); }
  reset() {
    this.x = 0; this.y = 0; this.heading = 0; this.penDown = true; this.visible = true; this.color = 1;
    this.lines = []; this.revision = (this.revision ?? 0) + 1;
  }
  clean() { this.lines = []; this.revision++; }
  clearScreen() { this.clean(); this.home(); }
  home() { this.x = 0; this.y = 0; this.heading = 0; }
  forward(distance) {
    const rad = this.heading * Math.PI / 180;
    this.setXY(this.x + Number(distance) * Math.sin(rad), this.y + Number(distance) * Math.cos(rad));
  }
  back(distance) { this.forward(-distance); }
  right(degrees) { this.setHeading(this.heading + Number(degrees)); }
  left(degrees) { this.setHeading(this.heading - Number(degrees)); }
  setHeading(degrees) { this.heading = angle(degrees); }
  setXY(x, y) {
    x = Number(x); y = Number(y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Coordinates must be finite numbers.');
    if (this.penDown) this.addLine(this.x, this.y, x, y, this.color);
    this.x = x; this.y = y;
  }
  setX(x) { this.setXY(x, this.y); }
  setY(y) { this.setXY(this.x, y); }
  penUp() { this.penDown = false; }
  penDownCommand() { this.penDown = true; }
  setPenState(down) { this.penDown = Boolean(down); }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  setPenColor(color) { if (validColor(color)) this.color = color; }
  setColor(color) { this.setPenColor(color); }
  towards(x, y) {
    const dx = x - this.x; const dy = y - this.y;
    return Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 ? this.heading : angle(Math.atan2(dx, dy) * 180 / Math.PI);
  }
  addLine(x1, y1, x2, y2, color = this.color) { this.lines.push({ x1, y1, x2, y2, color }); this.revision++; }
  snapshot() {
    return { x: this.x, y: this.y, heading: this.heading, penDown: this.penDown, visible: this.visible, color: this.color, lines: this.lines.map((line) => ({ ...line })) };
  }
  restore(state) {
    this.reset();
    for (const key of ['x', 'y', 'heading', 'penDown', 'visible', 'color']) if (state[key] !== undefined) this[key] = state[key];
    this.lines = (state.lines ?? []).map((line) => ({ ...line })); this.revision++;
  }
}

// Preserve editable built-in patterns; default drawing uses vector geometry.
const BUILTIN_PATTERNS = {
  1: [0,1,1,3,7,15,31,63,127,3,3,3,7,0,0,0,0,128,128,192,224,240,248,252,254,192,192,192,224,0,0,0],
  2: [0,0,0,127,127,127,127,127,127,127,62,62,0,0,0,0,0,0,0,0,0,252,254,254,254,254,124,124,0,0,0,0],
  3: [1,3,7,15,15,31,31,63,63,127,127,255,15,7,3,0,128,192,224,240,240,248,248,252,252,254,254,255,240,224,192,0],
  4: [0,7,31,63,127,127,255,255,255,255,127,127,63,31,7,0,0,224,248,252,254,254,255,255,255,255,254,254,252,248,224,0],
  5: [255,128,128,128,128,128,128,128,128,128,128,128,128,128,128,255,255,1,1,1,1,1,1,1,1,1,1,1,1,1,1,255],
};

export class SpriteManager {
  constructor() {
    this.patterns = new Map(); this.patternRevision = 0;
    this.resetPatterns();
    this.reset();
  }
  resetPatterns() {
    this.patterns.clear();
    for (const [id, data] of Object.entries(BUILTIN_PATTERNS)) this.patterns.set(Number(id), { data: [...data], custom: false });
    this.patternRevision++;
  }
  reset() {
    this.sprites = Array.from({ length: 32 }, (_, id) => ({ id, x: 0, y: 0, heading: 0, speed: 0, vx: null, vy: null, color: 1, shape: id % 5 + 1, visible: false }));
    this.selected = [0]; this.samplerId = null;
  }
  get selectedSprites() { return this.selected; }
  tell(ids) { this.selected = (Array.isArray(ids) ? ids : [ids]).filter((id) => validId(id, 32)); }
  tellAll() { this.selected = this.sprites.map((sprite) => sprite.id); }
  getSprite(id) { return this.sprites[validId(id, 32) ? id : 0]; }
  each(action) { for (const id of this.selected) action(this.sprites[id]); }
  setCarry(shape) { this.each((s) => { s.shape = Number(shape); s.visible = true; }); }
  setColor(color) { if (validColor(color)) this.each((s) => { s.color = color; }); }
  setHeading(degrees) { this.each((s) => { s.heading = angle(degrees); s.vx = null; s.vy = null; }); }
  setSpeed(speed) { this.each((s) => { s.speed = Number(speed); s.vx = null; s.vy = null; }); }
  setXVelocity(velocity) { this.each((s) => { s.vx = Number(velocity); }); }
  setYVelocity(velocity) { this.each((s) => { s.vy = Number(velocity); }); }
  setXY(x, y) { this.each((s) => { s.x = Number(x); s.y = Number(y); s.visible = true; }); }
  setX(x) { this.each((s) => { s.x = Number(x); s.visible = true; }); }
  setY(y) { this.each((s) => { s.y = Number(y); s.visible = true; }); }
  forward(distance) { this.each((s) => { const rad = s.heading * Math.PI / 180; s.x += distance * Math.sin(rad); s.y += distance * Math.cos(rad); }); }
  back(distance) { this.forward(-distance); }
  right(degrees) { this.each((s) => { s.heading = angle(s.heading + Number(degrees)); }); }
  left(degrees) { this.each((s) => { s.heading = angle(s.heading - Number(degrees)); }); }
  show() { this.each((s) => { s.visible = true; }); }
  hide() { this.each((s) => { s.visible = false; }); }
  clearSprites() { this.reset(); }
  setShapePattern(id, data) {
    if (!validId(id)) return;
    this.patterns.set(id, { data: bytes(data, 32), custom: true }); this.patternRevision++;
  }
  defineShape(id, data) { this.setShapePattern(id, data); }
  setShapeQuadrant(id, quadrant, data) {
    if (!validId(id) || !validId(quadrant, 4)) return;
    const pattern = [...(this.patterns.get(id)?.data ?? Array(32).fill(0))];
    pattern.splice(quadrant * 8, 8, ...bytes(data, 8)); this.setShapePattern(id, pattern);
  }
  getShapePattern(id) { return this.patterns.get(id)?.data ?? Array(32).fill(0); }
  /** dt multiplies Logo velocity, matching the native implementation. */
  updateMotion(dt = 1) {
    for (const s of this.sprites) {
      if (!s.visible || (s.speed === 0 && !s.vx && !s.vy)) continue;
      const rad = s.heading * Math.PI / 180;
      s.x += (s.vx ?? s.speed * Math.sin(rad)) * dt; s.y += (s.vy ?? s.speed * Math.cos(rad)) * dt;
      if (s.x > 128 || s.x < -128) s.x -= Math.ceil((Math.abs(s.x) - 128) / WIDTH) * WIDTH * Math.sign(s.x);
      if (s.y > 96 || s.y < -96) s.y -= Math.ceil((Math.abs(s.y) - 96) / HEIGHT) * HEIGHT * Math.sign(s.y);
    }
  }
  snapshot() {
    return { sprites: this.sprites.map((s) => ({ ...s })), selected: [...this.selected], samplerId: this.samplerId,
      patterns: Array.from(this.patterns, ([id, pattern]) => [id, { custom: pattern.custom, data: [...pattern.data] }]) };
  }
  restore(state) {
    this.reset();
    if (Array.isArray(state.sprites)) for (const s of state.sprites) if (validId(s.id, 32)) Object.assign(this.sprites[s.id], s);
    this.tell(state.selected ?? [0]); this.samplerId = state.samplerId ?? null;
    if (Array.isArray(state.patterns)) this.patterns = new Map(state.patterns.map(([id, pattern]) => [id, { custom: pattern.custom, data: [...pattern.data] }]));
    this.patternRevision++;
  }
}

export class VdpDisplay {
  constructor() {
    this.width = WIDTH; this.height = HEIGHT; this.patterns = new Map(); this.revision = 0;
    this.resetPatterns(); this.reset();
  }
  resetPatterns() {
    this.patterns.clear();
    this.setCharacterPattern(216, [255,136,136,136,255,34,34,34]);
    this.setCharacterPattern(224, [255,129,129,129,129,129,129,255]);
    for (const id of [225,226,227]) this.setCharacterPattern(id, [255,195,195,231,231,126,60,24]);
  }
  reset() {
    this.backgroundColor = 7; this.backgroundExplicit = false; this.samplerId = null;
    this.colors = Array(256).fill(1); this.tileBackgrounds = Array(256).fill(0);
    this.characterCursor = 0; this.clearTiles();
  }
  setBackgroundColor(color) {
    if (validColor(color)) { this.backgroundColor = color; this.backgroundExplicit = true; this.revision++; }
  }
  clearTiles() { this.tiles = Array(32 * 24).fill(0); this.revision++; }
  clearCharacters() { this.clearTiles(); this.characterCursor = 0; }
  setCharacterPattern(id, pattern) { if (validId(id)) { this.patterns.set(id, bytes(pattern, 8)); this.revision++; } }
  setTilePattern(id, pattern) { this.setCharacterPattern(id, pattern); }
  getCharacterPattern(id) { return this.patterns.get(id) ?? Array(8).fill(0); }
  putTile(id, col, row) {
    if (validId(col, 32) && validId(row, 24)) { this.tiles[row * 32 + col] = Number(id) & 255; this.revision++; }
  }
  getTile(col, row) { return validId(col, 32) && validId(row, 24) ? this.tiles[row * 32 + col] : 0; }
  setTileColor(id, color) {
    if (!validId(id)) return;
    const [foreground, background = 0] = Array.isArray(color) ? color : [color, 0];
    if (validColor(foreground) && validColor(background)) { this.colors[id] = foreground; this.tileBackgrounds[id] = background; this.revision++; }
  }
  getTileColor(id) { return validId(id) ? this.colors[id] : 1; }
  placeCharacter(id, col, row) {
    if (col === undefined) { col = this.characterCursor % 32; row = Math.floor(this.characterCursor / 32); this.characterCursor = (this.characterCursor + 1) % 768; }
    this.putTile(id, col, row);
  }
  snapshot() {
    return { backgroundColor: this.backgroundColor, backgroundExplicit: this.backgroundExplicit, samplerId: this.samplerId,
      characterCursor: this.characterCursor, tiles: [...this.tiles], colors: [...this.colors], tileBackgrounds: [...this.tileBackgrounds],
      patterns: Array.from(this.patterns, ([id, pattern]) => [id, [...pattern]]) };
  }
  restore(state) {
    this.reset();
    for (const key of ['backgroundColor','backgroundExplicit','samplerId','characterCursor']) if (state[key] !== undefined) this[key] = state[key];
    for (const key of ['tiles','colors','tileBackgrounds']) if (state[key]) this[key] = [...state[key]];
    if (state.patterns) this.patterns = new Map(state.patterns.map(([id, pattern]) => [id, [...pattern]]));
    this.revision++;
  }
}
