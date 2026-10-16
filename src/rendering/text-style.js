/** Canvas text uses the browser shaper, but not every CSS font/text property has
 * a Canvas equivalent. Unsupported styles stay native instead of silently
 * painting different glyphs. Spacing is feature-detected on the actual context.
 * https://html.spec.whatwg.org/multipage/canvas.html#canvastextdrawingstyles
 * https://www.w3.org/TR/css-text-3/#white-space-processing
 */
export const FONT_STYLE_KEYS = ['font','fontStyle','fontWeight','fontSize','fontFamily','fontKerning',
  'fontStretch','fontVariantCaps','fontFeatureSettings','fontVariationSettings','fontVariantLigatures',
  'fontVariantNumeric','fontVariantEastAsian','fontVariantPosition','fontOpticalSizing',
  'textRendering','wordSpacing','textTransform','textAlign','hyphens'];
const STRETCH = {'50%':'ultra-condensed','62.5%':'extra-condensed','75%':'condensed','87.5%':'semi-condensed',
  '100%':'normal','112.5%':'semi-expanded','125%':'expanded','150%':'extra-expanded','200%':'ultra-expanded'};
const DEFAULTS = {fontKerning:'auto', fontStretch:'normal', fontVariantCaps:'normal', textRendering:'auto', letterSpacing:'0px', wordSpacing:'0px'};
export function canvasTextStyle(style, context) {
  for (const key of ['fontFeatureSettings','fontVariationSettings','fontVariantLigatures',
    'fontVariantNumeric','fontVariantEastAsian','fontVariantPosition']) {
    if (style[key] && style[key] !== 'normal') return null;
  }
  if ((style.textTransform && style.textTransform !== 'none') || style.textAlign === 'justify' ||
      style.hyphens === 'auto' || style.fontOpticalSizing === 'none') return null;
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    let value = style[key] || fallback;
    if (key === 'fontStretch') value = STRETCH[value] || value;
    if (key.endsWith('Spacing')) {
      if (value === 'normal') value = '0px';
      if (!/^-?(?:\d*\.)?\d+px$/.test(value)) return null;
      if (parseFloat(value) === 0) value = '0px';
    }
    if (key === 'fontStretch' && !['normal', ...Object.values(STRETCH)].includes(value)) return null;
    if (!(key in context) && value !== fallback) return null;
    result[key] = value;
  }
  return result;
}
export function applyCanvasTextStyle(context, values) {
  for (const [key, value] of Object.entries(values)) if (key in context) context[key] = value;
}
export function normalizeTextRun(text, whiteSpace = 'normal') {
  // JS \s includes NBSP, narrow NBSP and other intentional Unicode spaces.
  // CSS collapses only document white space. Preserved tabs/line breaks need
  // layout/tab-stop processing; a Canvas single-line run cannot represent them.
  if (whiteSpace.startsWith('pre') || whiteSpace.includes('preserve') || whiteSpace === 'break-spaces') {
    return /[\t\r\n\f]/.test(text) ? null : text;
  }
  if (/[\u00ad\u200b]/u.test(text)) return null;
  return text.replace(/[\t\r\n\f ]+/g, ' ');
}
