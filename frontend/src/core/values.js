// Plain JavaScript values keep workspaces readable and easy to serialize.
export const listTokens = new WeakMap();
export const listItemTokens = new WeakMap();

/** Preserve executable list quoting across a JSON workspace round trip. */
export function serializeLogoValue(value) {
  if (!Array.isArray(value)) return value;
  return { $logoList: value.map(serializeLogoValue), tokens: listTokens.get(value), itemTokens: listItemTokens.get(value) };
}

export function deserializeLogoValue(value, depth = 0) {
  if (depth > 128) throw new Error('Workspace list nesting exceeds 128 levels');
  if (Array.isArray(value)) return value.map(item => deserializeLogoValue(item, depth + 1));
  if (value && typeof value === 'object' && Array.isArray(value.$logoList)) {
    const list = value.$logoList.map(item => deserializeLogoValue(item, depth + 1));
    if (Array.isArray(value.tokens)) listTokens.set(list, value.tokens);
    if (Array.isArray(value.itemTokens)) listItemTokens.set(list, value.itemTokens);
    return list;
  }
  return value;
}
export function logoString(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(logoString).join(' ');
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
  return String(value);
}

export function logoRepr(value) {
  if (Array.isArray(value)) return `[${value.map(logoRepr).join(' ')}]`;
  if (typeof value === 'string') return `"${value}`;
  return logoString(value);
}

export function logoNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') { const n = parseFloat(value); return Number.isFinite(n) ? n : 0; }
  return 0;
}

export const logoInt = value => {
  const n = logoNumber(value);
  // C++ round rounds halves away from zero.
  return n < 0 ? -Math.round(-n) : Math.round(n);
};

export function logoBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0 && value.toUpperCase() !== 'FALSE';
  return false;
}

export function logoEquals(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((value, i) => logoEquals(value, b[i]));
  if (typeof a === 'string' && typeof b === 'string') return a.toUpperCase() === b.toUpperCase();
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (typeof a !== typeof b && ['string', 'number'].includes(typeof a) && ['string', 'number'].includes(typeof b)) {
    return String(a).trim() !== '' && String(b).trim() !== '' && Number.isFinite(Number(a))
      && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) < 1e-9;
  }
  return a === b;
}

export const logoItems = value => Array.isArray(value) ? value : value == null ? [] : [value];
export const logoCount = value => Array.isArray(value) ? value.length
  : typeof value === 'string' || typeof value === 'number' ? logoString(value).length : 0;
export const logoEmpty = value => value == null || (Array.isArray(value) || typeof value === 'string') && value.length === 0;
