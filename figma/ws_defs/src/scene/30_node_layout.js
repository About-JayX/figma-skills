function serializeNodeLayout(node) {
  const layout = {};

  if (typeof node.x === 'number') {
    layout.x = roundNumber(node.x);
  }
  if (typeof node.y === 'number') {
    layout.y = roundNumber(node.y);
  }
  if (typeof node.width === 'number') {
    layout.width = roundNumber(node.width);
  }
  if (typeof node.height === 'number') {
    layout.height = roundNumber(node.height);
  }

  if (hasNodeProperty(node, 'absoluteBoundingBox') && node.absoluteBoundingBox) {
    layout.absoluteBoundingBox = serializeRect(node.absoluteBoundingBox);
  }
  if (hasNodeProperty(node, 'absoluteRenderBounds') && node.absoluteRenderBounds) {
    layout.absoluteRenderBounds = serializeRect(node.absoluteRenderBounds);
  }
  if (hasNodeProperty(node, 'relativeTransform') && node.relativeTransform) {
    layout.relativeTransform = serializeMatrix(node.relativeTransform);
  }
  if (hasNodeProperty(node, 'layoutMode') && typeof node.layoutMode === 'string') {
    layout.layoutMode = node.layoutMode;
  }
  if (hasNodeProperty(node, 'layoutWrap') && typeof node.layoutWrap === 'string') {
    layout.layoutWrap = node.layoutWrap;
  }
  if (
    hasNodeProperty(node, 'primaryAxisSizingMode') &&
    typeof node.primaryAxisSizingMode === 'string'
  ) {
    layout.primaryAxisSizingMode = node.primaryAxisSizingMode;
  }
  if (
    hasNodeProperty(node, 'counterAxisSizingMode') &&
    typeof node.counterAxisSizingMode === 'string'
  ) {
    layout.counterAxisSizingMode = node.counterAxisSizingMode;
  }
  if (
    hasNodeProperty(node, 'primaryAxisAlignItems') &&
    typeof node.primaryAxisAlignItems === 'string'
  ) {
    layout.primaryAxisAlignItems = node.primaryAxisAlignItems;
  }
  if (
    hasNodeProperty(node, 'counterAxisAlignItems') &&
    typeof node.counterAxisAlignItems === 'string'
  ) {
    layout.counterAxisAlignItems = node.counterAxisAlignItems;
  }
  if (
    hasNodeProperty(node, 'counterAxisAlignContent') &&
    typeof node.counterAxisAlignContent === 'string'
  ) {
    layout.counterAxisAlignContent = node.counterAxisAlignContent;
  }
  if (hasNodeProperty(node, 'itemSpacing') && typeof node.itemSpacing === 'number') {
    layout.itemSpacing = roundNumber(node.itemSpacing);
  }
  if (
    hasNodeProperty(node, 'counterAxisSpacing') &&
    typeof node.counterAxisSpacing === 'number'
  ) {
    layout.counterAxisSpacing = roundNumber(node.counterAxisSpacing);
  }
  if (hasNodeProperty(node, 'paddingTop') && typeof node.paddingTop === 'number') {
    layout.paddingTop = roundNumber(node.paddingTop);
  }
  if (hasNodeProperty(node, 'paddingRight') && typeof node.paddingRight === 'number') {
    layout.paddingRight = roundNumber(node.paddingRight);
  }
  if (hasNodeProperty(node, 'paddingBottom') && typeof node.paddingBottom === 'number') {
    layout.paddingBottom = roundNumber(node.paddingBottom);
  }
  if (hasNodeProperty(node, 'paddingLeft') && typeof node.paddingLeft === 'number') {
    layout.paddingLeft = roundNumber(node.paddingLeft);
  }
  if (hasNodeProperty(node, 'layoutAlign') && typeof node.layoutAlign === 'string') {
    layout.layoutAlign = node.layoutAlign;
  }
  if (hasNodeProperty(node, 'layoutGrow') && typeof node.layoutGrow === 'number') {
    layout.layoutGrow = roundNumber(node.layoutGrow);
  }
  if (
    hasNodeProperty(node, 'layoutPositioning') &&
    typeof node.layoutPositioning === 'string'
  ) {
    layout.layoutPositioning = node.layoutPositioning;
  }
  if (
    hasNodeProperty(node, 'strokesIncludedInLayout') &&
    typeof node.strokesIncludedInLayout === 'boolean'
  ) {
    layout.strokesIncludedInLayout = node.strokesIncludedInLayout;
  }
  if (hasNodeProperty(node, 'itemReverseZIndex') && typeof node.itemReverseZIndex === 'boolean') {
    layout.itemReverseZIndex = node.itemReverseZIndex;
  }
  if (
    hasNodeProperty(node, 'layoutSizingHorizontal') &&
    typeof node.layoutSizingHorizontal === 'string'
  ) {
    layout.layoutSizingHorizontal = node.layoutSizingHorizontal;
  }
  if (
    hasNodeProperty(node, 'layoutSizingVertical') &&
    typeof node.layoutSizingVertical === 'string'
  ) {
    layout.layoutSizingVertical = node.layoutSizingVertical;
  }
  if (hasNodeProperty(node, 'constraints') && node.constraints) {
    layout.constraints = serializeConstraints(node.constraints);
  }
  if (hasNodeProperty(node, 'minWidth') && typeof node.minWidth === 'number') {
    layout.minWidth = roundNumber(node.minWidth);
  }
  if (hasNodeProperty(node, 'maxWidth') && typeof node.maxWidth === 'number') {
    layout.maxWidth = roundNumber(node.maxWidth);
  }
  if (hasNodeProperty(node, 'minHeight') && typeof node.minHeight === 'number') {
    layout.minHeight = roundNumber(node.minHeight);
  }
  if (hasNodeProperty(node, 'maxHeight') && typeof node.maxHeight === 'number') {
    layout.maxHeight = roundNumber(node.maxHeight);
  }
  if (hasNodeProperty(node, 'clipsContent') && typeof node.clipsContent === 'boolean') {
    layout.clipsContent = node.clipsContent;
  }
  if (hasNodeProperty(node, 'gridRowCount') && typeof node.gridRowCount === 'number') {
    layout.gridRowCount = node.gridRowCount;
  }
  if (hasNodeProperty(node, 'gridColumnCount') && typeof node.gridColumnCount === 'number') {
    layout.gridColumnCount = node.gridColumnCount;
  }
  if (hasNodeProperty(node, 'gridRowGap') && typeof node.gridRowGap === 'number') {
    layout.gridRowGap = roundNumber(node.gridRowGap);
  }
  if (hasNodeProperty(node, 'gridColumnGap') && typeof node.gridColumnGap === 'number') {
    layout.gridColumnGap = roundNumber(node.gridColumnGap);
  }
  if (hasNodeProperty(node, 'gridRowSizes') && Array.isArray(node.gridRowSizes)) {
    layout.gridRowSizes = serializeGridTrackSizes(node.gridRowSizes, null);
  }
  if (hasNodeProperty(node, 'gridColumnSizes') && Array.isArray(node.gridColumnSizes)) {
    layout.gridColumnSizes = serializeGridTrackSizes(node.gridColumnSizes, null);
  }
  if (hasNodeProperty(node, 'gridRowSpan') && typeof node.gridRowSpan === 'number') {
    layout.gridRowSpan = node.gridRowSpan;
  }
  if (hasNodeProperty(node, 'gridColumnSpan') && typeof node.gridColumnSpan === 'number') {
    layout.gridColumnSpan = node.gridColumnSpan;
  }
  if (
    hasNodeProperty(node, 'gridRowAnchorIndex') &&
    typeof node.gridRowAnchorIndex === 'number'
  ) {
    layout.gridRowAnchorIndex = node.gridRowAnchorIndex;
  }
  if (
    hasNodeProperty(node, 'gridColumnAnchorIndex') &&
    typeof node.gridColumnAnchorIndex === 'number'
  ) {
    layout.gridColumnAnchorIndex = node.gridColumnAnchorIndex;
  }
  if (
    hasNodeProperty(node, 'gridChildHorizontalAlign') &&
    typeof node.gridChildHorizontalAlign === 'string'
  ) {
    layout.gridChildHorizontalAlign = node.gridChildHorizontalAlign;
  }
  if (
    hasNodeProperty(node, 'gridChildVerticalAlign') &&
    typeof node.gridChildVerticalAlign === 'string'
  ) {
    layout.gridChildVerticalAlign = node.gridChildVerticalAlign;
  }
  if (hasNodeProperty(node, 'inferredAutoLayout') && node.inferredAutoLayout) {
    layout.inferredAutoLayout = serializeInferredAutoLayout(node.inferredAutoLayout);
  }

  return layout;
}
