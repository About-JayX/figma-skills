export function normalizeNodeId(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    return null;
  }

  if (/^\d+:\d+$/.test(value)) {
    return value;
  }

  if (/^\d+-\d+$/.test(value)) {
    return value.replace('-', ':');
  }

  return null;
}

export function parseTarget(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    return null;
  }

  const nodeIdOnly = normalizeNodeId(raw);
  if (nodeIdOnly) {
    return {
      sourceType: 'node-id',
      raw,
      nodeId: nodeIdOnly,
      fileKey: null,
      url: null,
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(raw);
  } catch (error) {
    return null;
  }

  const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
  if (pathParts.length < 2) {
    return null;
  }

  const rootType = pathParts[0];
  if (rootType !== 'file' && rootType !== 'design') {
    return null;
  }

  const nodeId = normalizeNodeId(parsedUrl.searchParams.get('node-id'));
  if (!nodeId) {
    return null;
  }

  return {
    sourceType: 'url',
    raw,
    nodeId,
    fileKey: pathParts[1] || null,
    url: raw,
  };
}
