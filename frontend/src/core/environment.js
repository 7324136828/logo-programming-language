import { logoString } from './values.js';

export const BUILTIN_VARIABLES = {
  CLEAR: 0, BLACK: 1, GREEN: 2, LIME: 3, BLUE: 4, SKY: 5, RED: 6, CYAN: 7,
  RUST: 8, ORANGE: 9, YELLOW: 10, LEMON: 11, OLIVE: 12, PURPLE: 13, GRAY: 14, WHITE: 15,
  NORTH: 0, EAST: 90, SOUTH: 180, WEST: 270,
  PLANE: 1, TRUCK: 2, ROCKET: 3, BALL: 4, BOX: 5, TURTLE: 0,
  ALL: Array.from({ length: 32 }, (_, i) => i),
};
export const normalizeName = name => logoString(name).replace(/^[":]/, '').toUpperCase();

export class LogoEnvironment {
  constructor() { this.reset(); }
  reset() {
    this.variables = new Map(Object.entries(BUILTIN_VARIABLES).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
    this.procedures = new Map();
    this.scopes = [];
    this.testFlag = false;
    this.hasTest = false;
  }
  getVariable(name) {
    const key = normalizeName(name);
    for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(key)) return this.scopes[i].get(key);
    return this.variables.get(key) ?? null;
  }
  setVariable(name, value) {
    const key = normalizeName(name);
    for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(key)) { this.scopes[i].set(key, value); return; }
    this.variables.set(key, value);
  }
  setLocalVariable(name, value) { (this.scopes.at(-1) || this.variables).set(normalizeName(name), value); }
  hasVariable(name) { return this.scopes.some(scope => scope.has(normalizeName(name))) || this.variables.has(normalizeName(name)); }
  hasProcedure(name) { return this.procedures.has(normalizeName(name)); }
  getProcedure(name) { return this.procedures.get(normalizeName(name)); }
  defineProcedure(procedure) { this.procedures.set(normalizeName(procedure.name), procedure); }
  eraseVariable(name) { this.variables.delete(normalizeName(name)); }
  eraseProcedure(name) { this.procedures.delete(normalizeName(name)); }
  pushScope() { this.scopes.push(new Map()); }
  popScope() { this.scopes.pop(); }
}
