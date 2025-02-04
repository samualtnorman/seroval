export function serializeChar(str: string) {
  switch (str) {
    case '"': return '\\"';
    case '\\': return '\\\\';
    case '\n': return '\\n';
    case '\r': return '\\r';
    case '\b': return '\\b';
    case '\t': return '\\t';
    case '\f': return '\\f';
    case '<': return '\\x3C';
    case '\u2028': return '\\u2028';
    case '\u2029': return '\\u2029';
    default: return undefined;
  }
}

// Written by https://github.com/DylanPiercey and is distributed under the MIT license.
// Creates a JavaScript double quoted string and escapes all characters
// not listed as DoubleStringCharacters on
// Also includes "<" to escape "</script>" and "\" to avoid invalid escapes in the output.
// http://www.ecma-international.org/ecma-262/5.1/#sec-7.8.4
export function serializeString(str: string) {
  let result = '';
  let lastPos = 0;
  let replacement: string | undefined;
  for (let i = 0, len = str.length; i < len; i++) {
    replacement = serializeChar(str[i]);
    if (replacement) {
      result += str.slice(lastPos, i) + replacement;
      lastPos = i + 1;
    }
  }
  if (lastPos === 0) {
    result = str;
  } else {
    result += str.slice(lastPos);
  }
  return result;
}

export function deserializeString(str: string): string {
  return str
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\b/g, '\b')
    .replace(/\\t/g, '\t')
    .replace(/\\f/g, '\f')
    .replace(/\\x3C/g, '<')
    .replace(/\\u2028/g, '\u2028')
    .replace(/\\u2029/g, '\u2029');
}
