#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');
const DIAGNOSTICS_FILE = path.join(
  SKILL_ROOT,
  'ws_defs',
  'src',
  'transport',
  '56a_payload_diagnostics.js'
);

const errors = [];

function fail(message) {
  errors.push(message);
}

function loadDiagnosticsHelper() {
  if (!fs.existsSync(DIAGNOSTICS_FILE)) {
    throw new Error(`Missing diagnostics helper: ${DIAGNOSTICS_FILE}`);
  }

  const source = fs.readFileSync(DIAGNOSTICS_FILE, 'utf8');
  const context = vm.createContext({
    estimateJsonBytes(value) {
      return Buffer.byteLength(JSON.stringify(value), 'utf8');
    },
    getUtf8ByteLength(value) {
      return Buffer.byteLength(String(value == null ? '' : value), 'utf8');
    },
  });
  vm.runInContext(source, context, { filename: DIAGNOSTICS_FILE });

  if (typeof context.buildPayloadSizeDiagnostics !== 'function') {
    throw new Error('buildPayloadSizeDiagnostics is not defined');
  }

  return context.buildPayloadSizeDiagnostics;
}

function runChecks(buildPayloadSizeDiagnostics) {
  const payload = {
    defs: {
      flat: { color: '#fff' },
      summary: { total: 12 },
    },
    node: { id: '1:1', name: 'Root' },
    diagnostics: { designSnapshot: { css: { attached: 2 } } },
    restSnapshot: {
      truncated: true,
      bytes: 4096,
      reason: 'TRANSPORT_TRIM',
    },
    designSnapshot: {
      root: {
        id: '1:1',
        name: 'Hero',
        type: 'FRAME',
        css: { display: 'flex', gap: '24px' },
        svgString: '<svg><rect width="10" height="10" /></svg>',
        children: [
          {
            id: '1:2',
            name: 'Headline',
            type: 'TEXT',
            text: {
              characters: 'Hello world',
              segments: [
                {
                  characters: 'Hello',
                  start: 0,
                  end: 5,
                  fontName: { family: 'Inter', style: 'Bold' },
                },
                {
                  characters: ' world',
                  start: 5,
                  end: 11,
                  fontName: { family: 'Inter', style: 'Regular' },
                },
              ],
            },
            css: { fontSize: '32px' },
          },
          {
            id: '1:3',
            name: 'Decorative',
            type: 'BOOLEAN_OPERATION',
            svgString: '<svg><path d="M0 0L10 0L10 10Z"/></svg>',
          },
        ],
      },
      resources: {
        images: [{ imageHash: 'hash-1', count: 1 }],
      },
    },
  };

  const diagnostics = buildPayloadSizeDiagnostics(payload);

  if (!diagnostics || typeof diagnostics !== 'object') {
    fail('diagnostics should be an object');
    return;
  }

  if (typeof diagnostics.totalPayloadBytes !== 'number' || diagnostics.totalPayloadBytes <= 0) {
    fail('totalPayloadBytes should be a positive number');
  }

  if (!diagnostics.topLevelBytes || typeof diagnostics.topLevelBytes.designSnapshot !== 'number') {
    fail('topLevelBytes.designSnapshot should be present');
  } else if (diagnostics.topLevelBytes.designSnapshot <= diagnostics.topLevelBytes.defs) {
    fail('designSnapshot should be larger than defs for the mock payload');
  }

  const stats = diagnostics.designSnapshot && diagnostics.designSnapshot.rootStats;
  if (!stats) {
    fail('designSnapshot.rootStats should be present');
    return;
  }

  if (stats.nodeCount !== 3) {
    fail(`nodeCount should be 3, got ${stats.nodeCount}`);
  }

  if (stats.textNodeCount !== 1) {
    fail(`textNodeCount should be 1, got ${stats.textNodeCount}`);
  }

  if (stats.textSegmentCount !== 2) {
    fail(`textSegmentCount should be 2, got ${stats.textSegmentCount}`);
  }

  if (stats.cssNodeCount !== 2) {
    fail(`cssNodeCount should be 2, got ${stats.cssNodeCount}`);
  }

  if (stats.svgNodeCount !== 2) {
    fail(`svgNodeCount should be 2, got ${stats.svgNodeCount}`);
  }

  if (!stats.largestTextNode || stats.largestTextNode.id !== '1:2') {
    fail('largestTextNode should identify node 1:2');
  }

  if (!stats.largestSvgNode || stats.largestSvgNode.id !== '1:3' && stats.largestSvgNode.id !== '1:1') {
    fail('largestSvgNode should identify one of the svg-bearing nodes');
  }

  if (typeof stats.textCharactersBytes !== 'number' || stats.textCharactersBytes <= 0) {
    fail('textCharactersBytes should be positive');
  }

  if (typeof stats.textSegmentCharactersBytes !== 'number' || stats.textSegmentCharactersBytes <= 0) {
    fail('textSegmentCharactersBytes should be positive');
  }
}

function main() {
  try {
    const buildPayloadSizeDiagnostics = loadDiagnosticsHelper();
    runChecks(buildPayloadSizeDiagnostics);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const result =
    errors.length === 0
      ? {
          ok: true,
          checks: 10,
          message: 'Payload diagnostics checks passed',
        }
      : {
          ok: false,
          errors,
        };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main();
