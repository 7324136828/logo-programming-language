/** Logo tokens retain source positions so errors can point to the editor. */
export function tokenize(input) {
  const source = String(input).replace(/\r\n?/g, '\n');
  if (source.length > 2_000_000) throw new Error('Source exceeds the 2 MB editor limit');
  const tokens = [];
  let cursor = 0, line = 1, column = 1;
  const advance = () => {
    const char = source[cursor++];
    if (char === '\n') { line++; column = 1; } else column++;
    return char;
  };
  const delimiters = /[\s\[\]()+\-*/=<>;":]/;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === ';') { while (cursor < source.length && source[cursor] !== '\n') advance(); continue; }
    if (/[^\S\n]/.test(char)) { advance(); continue; }
    const position = { line, column, offset: cursor };
    if (char === '\n') { advance(); tokens.push({ type: 'newline', text: '\n', ...position }); continue; }
    if ('[]()'.includes(char)) { advance(); tokens.push({ type: char, text: char, ...position }); continue; }
    if ('+*/=<>'.includes(char)) {
      let text = advance();
      if ((char === '<' || char === '>') && source[cursor] === '=') text += advance();
      else if (char === '<' && source[cursor] === '>') text += advance();
      tokens.push({ type: text, text, ...position }); continue;
    }
    // A minus after a space introduces a signed input; an adjacent minus is infix.
    const signed = char === '-' && /[\d.]/.test(source[cursor + 1] || '')
      && (cursor === 0 || /[\s\[(+*/=<>]/.test(source[cursor - 1]));
    if (/\d/.test(char) || (char === '.' && /\d/.test(source[cursor + 1] || '')) || signed) {
      const match = source.slice(cursor).match(/^-?(?:\d+(?:\.\d*)?|\.\d+)/);
      if (match) {
        const text = match[0]; for (let i = 0; i < text.length; i++) advance();
        tokens.push({ type: 'number', text, value: Number(text), ...position }); continue;
      }
    }
    if (char === '-') { advance(); tokens.push({ type: '-', text: '-', ...position }); continue; }
    let type = 'word';
    if (char === '"' || char === ':') { type = char === '"' ? 'quoted' : 'variable'; advance(); }
    let text = '';
    while (cursor < source.length && !delimiters.test(source[cursor])) text += advance();
    if (!text && type === 'word') text = advance();
    tokens.push({ type, text, ...position });
  }
  tokens.push({ type: 'eof', text: '', line, column, offset: cursor });
  return tokens;
}

export class TokenStream {
  constructor(tokens) { this.tokens = tokens; this.cursor = 0; }
  peek() { return this.tokens[this.cursor] || { type: 'eof', text: '' }; }
  advance() { const token = this.peek(); if (this.cursor < this.tokens.length) this.cursor++; return token; }
  get hasMore() { return this.peek().type !== 'eof'; }
}

export function tokensToSource(tokens) {
  return tokens.filter(t => t.type !== 'eof').map(t => {
    if (t.type === 'quoted') return `"${t.text}`;
    if (t.type === 'variable') return `:${t.text}`;
    return t.text;
  }).join(' ').replace(/ *\n */g, '\n').trim();
}
