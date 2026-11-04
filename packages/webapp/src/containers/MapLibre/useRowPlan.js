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

// Draws planned rows (and the connected path) on top of the map. Passing null removes them.
// The collection can hold the rows of several fields. Rows with a `field` property get that field's colour, are
// labelled with their name (F1R12) and show their nodes (F1R12N0, F1R12N1, ...) once you zoom in.

import { useEffect } from 'react';
import { MAP_LABEL_FONT } from '../../util/mapProvider';

export const ROW_PLAN_SOURCE_ID = 'row-plan';
export const ROW_PLAN_ROWS_LAYER_ID = 'row-plan-rows';
export const ROW_PLAN_PATH_LAYER_ID = 'row-plan-path';
export const ROW_PLAN_LABELS_LAYER_ID = 'row-plan-labels';
export const ROW_PLAN_NODES_SOURCE_ID = 'row-plan-nodes';
export const ROW_PLAN_NODES_LAYER_ID = 'row-plan-nodes';
export const ROW_PLAN_NODE_LABELS_LAYER_ID = 'row-plan-node-labels';

// Fields take these colours in turn: field 1 first, field 7 wraps round to the first again.
export const FIELD_COLOURS = ['#00aaff', '#ffcc00', '#ff5ec4', '#7bd88f', '#ff7f50', '#b388ff'];
// 'at' gives a string, which MapLibre will not accept for a colour property without to-color.
const FIELD_COLOUR = [
  'to-color',
  [
    'at',
    ['%', ['-', ['to-number', ['coalesce', ['get', 'field'], 1], 1], 1], FIELD_COLOURS.length],
    ['literal', FIELD_COLOURS],
  ],
];
// Past this many nodes the node layers are skipped to keep the map responsive.
export const MAX_NODE_FEATURES = 30000;
const NODE_MIN_ZOOM = 17;
const NODE_LABEL_MIN_ZOOM = 18;

/** One point per row vertex, named like F1R12N3. Empty when there are too many to draw. */
export const nodeFeatures = (collection) => {
  const rows = (collection?.features ?? []).filter((f) => f.properties?.role === 'row');
  const total = rows.reduce((sum, f) => sum + (f.geometry?.coordinates?.length ?? 0), 0);
  if (total > MAX_NODE_FEATURES) return [];
  return rows.flatMap((f) => {
    const { name, row, field, node_start: start = 0 } = f.properties;
    const base = name ?? `R${row}`;
    return (f.geometry?.coordinates ?? []).map((coordinates, i) => ({
      type: 'Feature',
      properties: { name: `${base}N${start + i}`, field },
      geometry: { type: 'Point', coordinates },
    }));
  });
};

const removePlan = (map) => {
  [
    ROW_PLAN_NODE_LABELS_LAYER_ID,
    ROW_PLAN_NODES_LAYER_ID,
    ROW_PLAN_LABELS_LAYER_ID,
    ROW_PLAN_PATH_LAYER_ID,
    ROW_PLAN_ROWS_LAYER_ID,
  ].forEach((id) => {
    if (map.getLayer?.(id)) map.removeLayer(id);
  });
  [ROW_PLAN_NODES_SOURCE_ID, ROW_PLAN_SOURCE_ID].forEach((id) => {
    if (map.getSource?.(id)) map.removeSource(id);
  });
};

const LABEL_PAINT = {
  'text-color': '#ffffff',
  'text-halo-color': '#003a57',
  'text-halo-width': 1.5,
};

export default function useRowPlan({ map, collection }) {
  useEffect(() => {
    if (!map) return;
    removePlan(map);
    if (!collection?.features?.length) return;
    map.addSource(ROW_PLAN_SOURCE_ID, { type: 'geojson', data: collection });
    const hasPath = collection.features.some((f) => f.properties?.role === 'path');
    map.addLayer({
      id: ROW_PLAN_ROWS_LAYER_ID,
      type: 'line',
      source: ROW_PLAN_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'row'],
      paint: {
        'line-color': FIELD_COLOUR,
        'line-width': hasPath ? 1 : 2,
        'line-opacity': hasPath ? 0.5 : 1,
      },
    });
    if (hasPath) {
      map.addLayer({
        id: ROW_PLAN_PATH_LAYER_ID,
        type: 'line',
        source: ROW_PLAN_SOURCE_ID,
        filter: ['==', ['get', 'role'], 'path'],
        paint: { 'line-color': '#ff8800', 'line-width': 2 },
      });
    }
    const nodes = nodeFeatures(collection);
    if (nodes.length) {
      map.addSource(ROW_PLAN_NODES_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: nodes },
      });
      map.addLayer({
        id: ROW_PLAN_NODES_LAYER_ID,
        type: 'circle',
        source: ROW_PLAN_NODES_SOURCE_ID,
        minzoom: NODE_MIN_ZOOM,
        paint: {
          'circle-radius': 3,
          'circle-color': FIELD_COLOUR,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
        },
      });
      map.addLayer({
        id: ROW_PLAN_NODE_LABELS_LAYER_ID,
        type: 'symbol',
        source: ROW_PLAN_NODES_SOURCE_ID,
        minzoom: NODE_LABEL_MIN_ZOOM,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': MAP_LABEL_FONT,
          'text-size': 10,
          'text-anchor': 'top',
          'text-offset': [0, 0.6],
        },
        paint: LABEL_PAINT,
      });
    }
    // Row names, one label at the middle of each row. Labels that would overlap are dropped by MapLibre,
    // so a dense field shows more of them as you zoom in.
    map.addLayer({
      id: ROW_PLAN_LABELS_LAYER_ID,
      type: 'symbol',
      source: ROW_PLAN_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'row'],
      layout: {
        'symbol-placement': 'line-center',
        'text-field': ['coalesce', ['get', 'name'], ['to-string', ['get', 'row']]],
        'text-font': MAP_LABEL_FONT,
        'text-size': 12,
      },
      paint: LABEL_PAINT,
    });
    return () => {
      // The map may already have been removed when the page unmounts.
      try {
        removePlan(map);
      } catch {
        /* map is gone */
      }
    };
  }, [map, collection]);
}
