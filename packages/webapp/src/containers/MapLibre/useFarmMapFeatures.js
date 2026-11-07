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

// Draws the docks and routes of the farm map being built, and the route being drawn, on top of the map.
// While `placing` is set, a click on the map calls onPlace with the point instead of selecting a location.

import { useEffect } from 'react';
import { MAP_LABEL_FONT } from '../../util/mapProvider';

export const FEATURES_SOURCE_ID = 'farm-map-features';
export const FEATURES_DRAFT_SOURCE_ID = 'farm-map-features-draft';
const LAYER_IDS = [
  'farm-map-draft-points',
  'farm-map-draft-line',
  'farm-map-feature-labels',
  'farm-map-docks',
  'farm-map-waypoints',
  'farm-map-routes',
];
const SOURCE_IDS = [FEATURES_DRAFT_SOURCE_ID, FEATURES_SOURCE_ID];

const COLOUR = '#e8590c';

const remove = (map) => {
  LAYER_IDS.forEach((id) => {
    if (map.getLayer?.(id)) map.removeLayer(id);
  });
  SOURCE_IDS.forEach((id) => {
    if (map.getSource?.(id)) map.removeSource(id);
  });
};

const empty = { type: 'FeatureCollection', features: [] };

/** The clicks of the route being drawn, as a line and its points. */
export const draftCollection = (points) => ({
  type: 'FeatureCollection',
  features: [
    ...(points.length > 1
      ? [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) },
          },
        ]
      : []),
    ...points.map((p) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })),
  ],
});

export default function useFarmMapFeatures({ map, collection, draftPoints, placing, onPlace }) {
  // Sources and layers, made once and kept up to date by the effect below.
  useEffect(() => {
    if (!map) return;
    remove(map);
    map.addSource(FEATURES_SOURCE_ID, { type: 'geojson', data: empty });
    map.addSource(FEATURES_DRAFT_SOURCE_ID, { type: 'geojson', data: empty });
    map.addLayer({
      id: 'farm-map-routes',
      type: 'line',
      source: FEATURES_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'route'],
      paint: { 'line-color': COLOUR, 'line-width': 3, 'line-dasharray': [2, 1] },
    });
    map.addLayer({
      id: 'farm-map-waypoints',
      type: 'circle',
      source: FEATURES_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'waypoint'],
      paint: {
        'circle-radius': 4,
        'circle-color': '#ffffff',
        'circle-stroke-color': COLOUR,
        'circle-stroke-width': 2,
      },
    });
    map.addLayer({
      id: 'farm-map-docks',
      type: 'circle',
      source: FEATURES_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'dock'],
      paint: {
        'circle-radius': 8,
        'circle-color': COLOUR,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });
    map.addLayer({
      id: 'farm-map-feature-labels',
      type: 'symbol',
      source: FEATURES_SOURCE_ID,
      filter: ['!=', ['get', 'role'], 'waypoint'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': MAP_LABEL_FONT,
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#7a2e05', 'text-halo-width': 1.5 },
    });
    map.addLayer({
      id: 'farm-map-draft-line',
      type: 'line',
      source: FEATURES_DRAFT_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': '#fab005', 'line-width': 3 },
    });
    map.addLayer({
      id: 'farm-map-draft-points',
      type: 'circle',
      source: FEATURES_DRAFT_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#fab005',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });
    return () => {
      // The map may already have been removed when the page unmounts.
      try {
        remove(map);
      } catch {
        /* map is gone */
      }
    };
  }, [map]);

  useEffect(() => {
    map?.getSource?.(FEATURES_SOURCE_ID)?.setData(collection ?? empty);
  }, [map, collection]);

  useEffect(() => {
    map?.getSource?.(FEATURES_DRAFT_SOURCE_ID)?.setData(draftCollection(draftPoints ?? []));
  }, [map, draftPoints]);

  useEffect(() => {
    if (!map || !placing) return;
    const handler = (event) => onPlace({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = 'crosshair';
    map.on('click', handler);
    return () => {
      try {
        map.off('click', handler);
        if (canvas) canvas.style.cursor = '';
      } catch {
        /* map is gone */
      }
    };
  }, [map, placing, onPlace]);
}
