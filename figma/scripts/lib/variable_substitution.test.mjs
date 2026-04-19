import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  figmaNameToCssVar,
  buildNodeTokens,
  buildSubstitutionMap,
  enrichNodeTokens,
} from './variable_substitution.mjs';

test('figmaNameToCssVar: standard names', () => {
  assert.equal(figmaNameToCssVar('Color/neutrals/950'), '--color-neutrals-950');
  assert.equal(figmaNameToCssVar('Line Height/text-xs'), '--line-height-text-xs');
  assert.equal(figmaNameToCssVar('font-size/text-xs'), '--font-size-text-xs');
});

test('figmaNameToCssVar: Chinese characters preserved as Unicode', () => {
  assert.equal(figmaNameToCssVar('圆角参数/CR0-无圆角'), '--圆角参数-cr0-无圆角');
  assert.equal(figmaNameToCssVar('间距/SP0'), '--间距-sp0');
});

test('figmaNameToCssVar: invalid returns null', () => {
  assert.equal(figmaNameToCssVar(''), null);
  assert.equal(figmaNameToCssVar(null), null);
  assert.equal(figmaNameToCssVar(123), null);
});

test('buildNodeTokens: maps Figma props to CSS props', () => {
  const bound = {
    fills: [{ id: 'v1', name: 'Color/brand/500', type: 'COLOR' }],
    fontSize: [{ id: 'v2', name: 'Font Size/text-xs', type: 'FLOAT' }],
    itemSpacing: [{ id: 'v3', name: 'Spacing/sp-2', type: 'FLOAT' }],
    topLeftRadius: [{ id: 'v4', name: 'Radius/cr-2', type: 'FLOAT' }],
  };
  const tokens = buildNodeTokens(bound);
  assert.deepEqual(tokens.color, {
    cssVar: '--color-brand-500',
    figmaProp: 'fills',
    variable: { name: 'Color/brand/500', id: 'v1', type: 'COLOR' },
  });
  assert.equal(tokens['font-size'].cssVar, '--font-size-text-xs');
  assert.equal(tokens.gap.cssVar, '--spacing-sp-2');
  assert.equal(tokens['border-top-left-radius'].cssVar, '--radius-cr-2');
});

test('buildNodeTokens: empty input returns null', () => {
  assert.equal(buildNodeTokens(null), null);
  assert.equal(buildNodeTokens({}), null);
});

test('buildNodeTokens: unknown Figma prop preserves name', () => {
  const tokens = buildNodeTokens({
    someCustomProp: { id: 'v1', name: 'Custom/alpha', type: 'FLOAT' },
  });
  assert.ok(tokens.someCustomProp);
  assert.equal(tokens.someCustomProp.cssVar, '--custom-alpha');
});

test('buildSubstitutionMap: flattens resources.full into lookup', () => {
  const defs = {
    Colors: {
      collectionId: 'col1',
      defaultModeId: 'mode-light',
      variables: {
        'Color/brand/500': {
          type: 'COLOR',
          values: { Light: '#FF0000', Dark: '#FFCCCC' },
        },
      },
    },
  };
  const map = buildSubstitutionMap(defs);
  assert.equal(map['Color/brand/500'].cssVar, '--color-brand-500');
  assert.equal(map['Color/brand/500'].collectionName, 'Colors');
  assert.deepEqual(map['Color/brand/500'].values, { Light: '#FF0000', Dark: '#FFCCCC' });
});

test('enrichNodeTokens: walks tree and attaches computedCss.tokens', () => {
  const root = {
    id: 'a',
    children: [
      {
        id: 'b',
        variables: {
          bound: {
            fills: [{ id: 'v1', name: 'Color/x/y', type: 'COLOR' }],
          },
        },
      },
      { id: 'c' },
    ],
  };
  const count = enrichNodeTokens(root);
  assert.equal(count, 1);
  assert.equal(root.children[0].computedCss.tokens.color.cssVar, '--color-x-y');
  assert.equal(root.children[1].computedCss, undefined);
});
