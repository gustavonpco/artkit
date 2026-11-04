export {
  chartExtent,
  chartLegendPosition,
  formatChartValue,
  type LegendPosition,
  niceScale,
  type Scale,
} from './chart-scale.js';
export {
  type ComposedSlide,
  type ComposedSlot,
  type ComposeOptions,
  composeSlide,
  DEFAULT_SHAPE_TEXT_STYLE,
  DEFAULT_TEXT_STYLE,
  elementPlainText,
  FOOTER_BOX,
  type Primitive,
  type PrimitiveSource,
  type ResolvedTextStyle,
  resolveTextStyle,
  SLIDE_NUMBER_BOX,
  slideTitle,
  slotPlainText,
  slotPrimitives,
} from './compose.js';
export { diffSlides } from './diff.js';
export {
  checkChartFields,
  checkElement,
  checkTableFields,
  type FieldProblem,
  tableColumnCount,
  tableColumnWidths,
  textElementParagraphs,
} from './elements.js';
export * from './geometry.js';
export { outlineInput, outlineToSlides } from './inputs.js';
export { createInstructions } from './instructions.js';
export {
  createSlidesKind,
  SLIDES_LIMITS,
  type SlidesKind,
  type SlidesKindOptions,
  slidesKind,
} from './kind.js';
export {
  assertLayoutDefinition,
  BUILT_IN_LAYOUTS,
  builtInLayouts,
  createLayoutRegistry,
  fallbackLayout,
  isTitleRole,
  type LayoutDecoration,
  type LayoutDefinition,
  LayoutDefinitionError,
  type LayoutRegistry,
  type LayoutSlot,
  type RoleStyle,
  resolveLayout,
  TYPOGRAPHY,
  type TypographyRole,
} from './layouts.js';
export {
  LINT_CODES,
  lintSlides,
  MAX_BULLETS,
  MIN_CONTRAST,
  MIN_CONTRAST_LARGE,
  primitiveTarget,
  type SlidesLintCode,
} from './lint.js';
export {
  createApply,
  ELEMENT_ID_PREFIX,
  migrateSlots,
  type SlidesOperation,
  type SlotMigration,
  slidesOperationSchema,
  slidesOperationTargets,
} from './operations.js';
export { normalizeSlides, parsePartialSlides } from './partial.js';
export { projectSlide, projectSlides, slideOutline } from './projection.js';
export * from './schema.js';
export {
  denormalizeParagraph,
  listOrdinals,
  mergeRuns,
  type NormalizedParagraph,
  normalizeParagraph,
  normalizeParagraphs,
  paragraphText,
} from './text.js';
export {
  averageCharWidth,
  estimateTableHeight,
  estimateTextFit,
  OVERFLOW_TOLERANCE,
  TEXT_BOX,
  type TextFit,
  type TextFitInput,
  wrapLineCount,
} from './text-metrics.js';
export { checkSlotContent, type SlotProblem, validateSlides } from './validate.js';
