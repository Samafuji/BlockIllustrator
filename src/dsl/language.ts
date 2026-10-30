import { StreamLanguage, StringStream } from '@codemirror/language';

const NODE_WORDS = new Set([
  'block',
  'rounded',
  'circle',
  'diamond',
  'gain',
  'sum',
  'junction',
  'text',
  'box',
  'rect',
  'input',
  'output',
  'label',
  'dot',
  'branch',
  'node',
  'ellipse',
  'triangle',
  'style',
  'image',
  'img',
  'picture',
  'photo',
  'asset',
]);

const ATTR_WORDS = new Set([
  'at',
  'pos',
  'size',
  'w',
  'h',
  'fill',
  'stroke',
  'color',
  'fontsize',
  'font-size',
  'width',
  'radius',
  'flip',
  'hidden',
  'nodot',
  'visible',
  'plain',
  'cross',
  'sigma',
  'label',
  'sign',
  'via',
  'through',
  'points',
  'offset',
  'arrow',
  'dashed',
  'dotted',
  'solid',
  'straight',
  'auto',
  'ortho',
  'lw',
  'hidden',
  'src',
  'caption',
  'bold',
  'italic',
  'underline',
  'normal',
  'font',
  'align',
  'rotate',
  'arrowsize',
  'jump',
  'nojump',
]);

export const blockDiagramLanguage = StreamLanguage.define<{ lineStart: boolean }>({
  startState: () => ({ lineStart: true }),
  token(stream: StringStream, state) {
    if (stream.sol()) state.lineStart = true;
    if (stream.eatSpace()) return null;
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/"(?:[^"\\]|\\.)*"?/)) {
      state.lineStart = false;
      return 'string';
    }
    if (stream.match(/#[0-9a-fA-F]{3,8}\b/)) {
      state.lineStart = false;
      return 'atom';
    }
    if (stream.match(/[-+]?\d+(\.\d+)?/)) {
      state.lineStart = false;
      return 'number';
    }
    if (stream.match(/<->|->|<-|--/)) {
      state.lineStart = false;
      return 'operator';
    }
    if (stream.match(/[A-Za-z_][\w-]*/)) {
      const word = stream.current().toLowerCase();
      const first = state.lineStart;
      state.lineStart = false;
      if (first && NODE_WORDS.has(word)) return 'keyword';
      if (!first && ATTR_WORDS.has(word)) return 'propertyName';
      if (/^(left|right|top|bottom|center|triangle|open|none|dot|both)$/.test(word)) return 'atom';
      return 'variableName';
    }
    stream.next();
    state.lineStart = false;
    return null;
  },
  languageData: { commentTokens: { line: '//' } },
});
