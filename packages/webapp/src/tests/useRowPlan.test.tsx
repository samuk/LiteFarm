/*
 *  Copyright 2026 LiteFarm.org
 *  This file is part of LiteFarm.
 *
 *  LiteFarm is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  LiteFarm is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 *  GNU General Public License for more details, see <https://www.gnu.org/licenses/>.
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useRowPlan, {
  nodeFeatures,
  ROW_PLAN_LABELS_LAYER_ID,
  ROW_PLAN_NODE_LABELS_LAYER_ID,
  ROW_PLAN_NODES_LAYER_ID,
  ROW_PLAN_NODES_SOURCE_ID,
  ROW_PLAN_PATH_LAYER_ID,
  ROW_PLAN_ROWS_LAYER_ID,
  ROW_PLAN_SOURCE_ID,
} from '../containers/MapLibre/useRowPlan';

const makeMap = () => {
  const layers = new Set<string>();
  const sources = new Set<string>();
  return {
    layers,
    sources,
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    getSource: vi.fn((id: string) => (sources.has(id) ? { id } : undefined)),
    addSource: vi.fn((id: string) => sources.add(id)),
    addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
    removeLayer: vi.fn((id: string) => layers.delete(id)),
    removeSource: vi.fn((id: string) => sources.delete(id)),
  };
};

const feature = (role: string) => ({
  type: 'Feature',
  properties: { role },
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 1],
    ],
  },
});
const collection = (...roles: string[]) => ({
  type: 'FeatureCollection',
  features: roles.map(feature),
});

describe('useRowPlan', () => {
  it('does nothing without a map or a plan', () => {
    const map = makeMap();
    renderHook(() => useRowPlan({ map: null, collection: collection('row') }));
    renderHook(() => useRowPlan({ map, collection: null }));
    expect(map.addSource).not.toHaveBeenCalled();
  });
  it('adds rows only when there is no path', () => {
    const map = makeMap();
    renderHook(() => useRowPlan({ map, collection: collection('row', 'row') }));
    expect(map.sources.has(ROW_PLAN_SOURCE_ID)).toBe(true);
    expect(map.layers.has(ROW_PLAN_ROWS_LAYER_ID)).toBe(true);
    expect(map.layers.has(ROW_PLAN_LABELS_LAYER_ID)).toBe(true);
    expect(map.layers.has(ROW_PLAN_PATH_LAYER_ID)).toBe(false);
  });
  it('adds the path layer above the rows when there is a path', () => {
    const map = makeMap();
    renderHook(() => useRowPlan({ map, collection: collection('row', 'path') }));
    expect([...map.layers].slice(0, 2)).toEqual([ROW_PLAN_ROWS_LAYER_ID, ROW_PLAN_PATH_LAYER_ID]);
  });
  it('replaces the plan when the collection changes and removes it on null and unmount', () => {
    const map = makeMap();
    const { rerender, unmount } = renderHook(({ c }) => useRowPlan({ map, collection: c }), {
      initialProps: { c: collection('row', 'path') as any },
    });
    rerender({ c: collection('row') });
    expect(map.layers.has(ROW_PLAN_PATH_LAYER_ID)).toBe(false);
    expect(map.layers.has(ROW_PLAN_ROWS_LAYER_ID)).toBe(true);
    rerender({ c: null });
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
    rerender({ c: collection('row') });
    unmount();
    expect(map.layers.size).toBe(0);
  });
  it('survives a map that was already removed', () => {
    const map = makeMap();
    const { unmount } = renderHook(() => useRowPlan({ map, collection: collection('row') }));
    map.getLayer.mockImplementation(() => {
      throw new Error('gone');
    });
    expect(() => unmount()).not.toThrow();
  });
});

describe('row and node names on the map', () => {
  const named = (field: number, row: number, start = 0) => ({
    type: 'Feature',
    properties: { role: 'row', row, field, name: `F${field}R${row}`, node_start: start },
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
  });

  it('names nodes from the row name and first node number', () => {
    const nodes = nodeFeatures({ features: [named(2, 5, 2)] });
    expect(nodes.map((n: any) => n.properties.name)).toEqual(['F2R5N2', 'F2R5N3']);
  });
  it('skips nodes past the limit', () => {
    const many = {
      features: [
        {
          ...named(1, 1),
          geometry: { type: 'LineString', coordinates: Array(30001).fill([0, 0]) },
        },
      ],
    };
    expect(nodeFeatures(many)).toEqual([]);
  });
  it('adds node layers for rows of several fields and removes them with the plan', () => {
    const map = makeMap();
    const c = { type: 'FeatureCollection', features: [named(1, 1), named(2, 1)] };
    const { rerender } = renderHook(({ c }) => useRowPlan({ map, collection: c }), {
      initialProps: { c: c as any },
    });
    expect(map.sources.has(ROW_PLAN_NODES_SOURCE_ID)).toBe(true);
    expect(map.layers.has(ROW_PLAN_NODES_LAYER_ID)).toBe(true);
    expect(map.layers.has(ROW_PLAN_NODE_LABELS_LAYER_ID)).toBe(true);
    rerender({ c: null });
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });
});
