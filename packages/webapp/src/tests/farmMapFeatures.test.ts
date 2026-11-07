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

import { describe, expect, it } from 'vitest';
import {
  buildRoute,
  dockNodesOf,
  featuresToCollection,
  nearestNode,
  nextDockName,
  nextRouteName,
  removeFeature,
  rowNodesOf,
  toApiFeatures,
  MapFeature,
} from '../util/farmMapFeatures';

const rows = {
  features: [
    {
      properties: { role: 'row', node_names: ['F1R0N0', 'F1R0N1'] },
      geometry: {
        coordinates: [
          [3.66, 48.0],
          [3.661, 48.0],
        ],
      },
    },
    { properties: { role: 'field' }, geometry: { coordinates: [[0, 0]] } },
  ],
};
const dock: MapFeature = {
  kind: 'dock',
  name: 'dock',
  points: [{ lat: 47.9999, lng: 3.6599 }],
  heading_deg: 90,
};

describe('dock and route names', () => {
  it('names docks dock, dock1, dock2 and fills gaps', () => {
    expect(nextDockName([])).toBe('dock');
    expect(nextDockName([dock])).toBe('dock1');
    expect(nextDockName([dock, { ...dock, name: 'dock2' }])).toBe('dock1');
  });
  it('names routes route1, route2', () => {
    expect(nextRouteName([])).toBe('route1');
    expect(nextRouteName([{ ...dock }, { ...dock, name: 'x' }])).toBe('route1');
  });
});

describe('nodes', () => {
  it('lists the row nodes by the names the api gives them', () => {
    expect(rowNodesOf(rows)).toEqual([
      { name: 'F1R0N0', lat: 48.0, lng: 3.66 },
      { name: 'F1R0N1', lat: 48.0, lng: 3.661 },
    ]);
    expect(rowNodesOf(null)).toEqual([]);
  });
  it('finds the nearest node within reach only', () => {
    const nodes = rowNodesOf(rows);
    expect(nearestNode({ lat: 48.00002, lng: 3.66 }, nodes)?.name).toBe('F1R0N0');
    expect(nearestNode({ lat: 48.001, lng: 3.66 }, nodes)).toBeNull();
  });
});

describe('buildRoute', () => {
  const nodes = [...dockNodesOf([dock]), ...rowNodesOf(rows)];
  it('snaps both ends to nodes and keeps the clicks between as waypoints', () => {
    const result = buildRoute(
      'route1',
      [
        { lat: 47.99991, lng: 3.6599 },
        { lat: 47.99995, lng: 3.65995 },
        { lat: 48.00001, lng: 3.66 },
      ],
      nodes,
    );
    expect(result).toEqual({
      route: {
        kind: 'route',
        name: 'route1',
        from_node: 'dock',
        to_node: 'F1R0N0',
        points: [
          { lat: 47.9999, lng: 3.6599 },
          { lat: 47.99995, lng: 3.65995 },
          { lat: 48.0, lng: 3.66 },
        ],
      },
    });
  });
  it('says which end is not on a node', () => {
    expect(buildRoute('r', [{ lat: 1, lng: 1 }], nodes)).toEqual({ error: 'TOO_FEW_POINTS' });
    expect(
      buildRoute(
        'r',
        [
          { lat: 1, lng: 1 },
          { lat: 48, lng: 3.66 },
        ],
        nodes,
      ),
    ).toEqual({ error: 'START' });
    expect(
      buildRoute(
        'r',
        [
          { lat: 47.9999, lng: 3.6599 },
          { lat: 1, lng: 1 },
        ],
        nodes,
      ),
    ).toEqual({ error: 'END' });
  });
  it('refuses a route that starts and ends on the same node', () => {
    expect(
      buildRoute(
        'r',
        [
          { lat: 47.9999, lng: 3.6599 },
          { lat: 47.99995, lng: 3.6599 },
          { lat: 47.9999, lng: 3.6599 },
        ],
        nodes,
      ),
    ).toEqual({ error: 'END' });
  });
});

describe('features', () => {
  const route: MapFeature = {
    kind: 'route',
    name: 'route1',
    from_node: 'dock',
    to_node: 'F1R0N0',
    points: [
      { lat: 47.9999, lng: 3.6599 },
      { lat: 47.99995, lng: 3.65995 },
      { lat: 48.0, lng: 3.66 },
    ],
  };
  it('sends the api only the fields it knows', () => {
    expect(toApiFeatures([dock, route])).toEqual([
      { kind: 'dock', name: 'dock', points: dock.points, heading_deg: 90 },
      {
        kind: 'route',
        name: 'route1',
        points: route.points,
        from_node: 'dock',
        to_node: 'F1R0N0',
      },
    ]);
  });
  it('draws docks as points, routes as lines and their waypoints as points', () => {
    const roles = featuresToCollection([dock, route]).features.map((f) => f.properties.role);
    expect(roles).toEqual(['dock', 'route', 'waypoint']);
  });
  it('removing a dock removes the routes that start or end there', () => {
    expect(removeFeature([dock, route], 'dock')).toEqual([]);
    expect(removeFeature([dock, route], 'route1')).toEqual([dock]);
  });
});
