// Characters that XML 1.0 does not allow anywhere in a document: C0 controls other
// than tab / newline / carriage return, DEL, U+FFFE / U+FFFF and unpaired surrogates.
// They are invisible on the canvas (the browser's DOM accepts them) but a single one
// makes an exported SVG "not well-formed", so no viewer opens the file. The usual
// source is text pasted from PowerPoint / Word, whose soft line break (Shift+Enter)
// is U+000B.
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Remove the characters XML cannot carry (see above). Tab, newline and CR are kept. */
export function stripXmlInvalid(s: string): string {
  return s.replace(XML_INVALID, '');
}
