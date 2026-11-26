// PowerPoint -> Block Illustrator: entry points used by the actions.
//  - .pptx files (opened, dropped, double-clicked): one diagram per slide (DrawingML)
//  - SVG that PowerPoint puts on the clipboard / saves with "Save as Picture"

export { diagramsFromPptx } from './pptxImport';
export type { ImportedSlide } from './pptxImport';
export { diagramFromSvg as diagramFromPowerPointSvg, isSvgText as isPowerPointSvg } from './svgImport';
