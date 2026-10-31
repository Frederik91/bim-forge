/** Approved Inside-first study #249. This is the shared CSS, SVG and material authority. */
export const spatialTokens = {
  color: {
    ink: '#172f41', muted: '#506775', primary: '#234eaa', primaryHover: '#173d8c',
    selection: '#325cc2', selectionFill: '#dce5fc', focus: '#3463c3',
    paper: '#fcfdfd', white: '#ffffff', canvas: '#e9eef0', soft: '#f6f9fb',
    border: '#b7c6cf', input: '#9aafb9', hover: '#e2eaf4',
    disabledInk: '#5e6c77', disabledFill: '#edf1f3',
    warning: '#704308', warningFill: '#f6ecd9', error: '#a1322a', errorFill: '#fbece9',
    success: '#23665f', successFill: '#e5f2ee',
    drawingPaper: '#eef0ed', drawingInk: '#253b49', drawingMuted: '#536571',
    drawingOutline: '#82939c', wall: '#c8d0d1', floor: '#f9faf7',
    furniture: '#e0e6e4', furnitureOutline: '#7a8c92',
    existing: '#647b89', proposed: '#9b5b12', proposedText: '#674308', proposedFill: '#f4e3c5',
    agentBody: '#325cc2', agentFace: '#e1edf6', agentEyes: '#172f41',
  },
  font: { ui: '"Segoe UI", Arial, sans-serif', drawing: 'Arial, Helvetica, sans-serif' },
  type: { body: '14px', small: '13px', caption: '12px', heading: '18px', title: '24px', lineHeight: '1.45' },
  space: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px', section: '32px' },
  radius: { control: '6px', group: '7px', panel: '12px' },
  control: { target: '44px', focusWidth: '3px', focusOffset: '3px' },
  elevation: { panel: '0 9px 32px #172f4133' },
  drafting: { detail: 1, outline: 1.3, existing: 1.5, selected: 2, cut: 2.3, dimension: 1,
    dimensionText: 13, labelHalo: 4, existingDash: '5 4', regionDash: '8 4' },
} as const;

/** Derive consumer subsets with Pick<SpatialTokens['color'], ...>, rather than copying a palette. */
export type SpatialTokens = typeof spatialTokens;

/** CSS is generated at build time; numeric drawing values intentionally remain unitless SVG values. */
export function spatialTokenCss(): string {
  const declarations = Object.entries(spatialTokens).flatMap(([group, values]) =>
    Object.entries(values).map(([name, value]) =>
      `  --spatial-${group}-${name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())}: ${value};`));
  return `/* Generated from demo/ui/design-tokens.ts. */\n:root {\n${declarations.join('\n')}\n}\n`;
}
