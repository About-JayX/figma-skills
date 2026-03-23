function paintListHasTypes(paints, typeMap) {
  if (!Array.isArray(paints)) {
    return false;
  }

  for (let i = 0; i < paints.length; i += 1) {
    const paint = paints[i];
    if (paint && paint.type && typeMap[paint.type]) {
      return true;
    }
  }

  return false;
}

function paintListHasFilters(paints) {
  if (!Array.isArray(paints)) {
    return false;
  }

  for (let i = 0; i < paints.length; i += 1) {
    const paint = paints[i];
    if (paint && paint.filters && countKeys(paint.filters) > 0) {
      return true;
    }
  }

  return false;
}
