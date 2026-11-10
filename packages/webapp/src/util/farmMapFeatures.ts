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

// Docks and routes of a farm map, drawn by hand. A dock is one point where a robot charges. A route is a line from
// one node (a dock or a row node such as F1R0N0) to another, and the points between are waypoints. The api checks
// the same rules when the map is saved, so these helpers only need to make the common mistakes hard to make.

import { distanceBetween, LatLng } from './mapLibre/geodesy';

export type DockFeature = {
  kind: 'dock';
  name: string;
  points: LatLng[];
  heading_deg: number | null;
  from_node?: null;
  to_node?: null;
};

export type RouteFeature = {
  kind: 'route';
  name: string;
  points: LatLng[];
  heading_deg?: null;
  from_node: string;
  to_node: string;
};

export type MapFeature = DockFeature | RouteFeature;

export type NamedNode = LatLng & { name: string };

// The api refuses a route whose end is further than this from the node it joins.
export const ROUTE_END_TOLERANCE_M = 10;
// How far from a node a click still counts as being on it. Inside the api's limit, so a snapped end always passes.
export const SNAP_DISTANCE_M = 8;

const nextName = (prefix: string, features: MapFeature[], kind: MapFeature['kind']): string => {
  const used = new Set(features.filter((f) => f.kind === kind).map((f) => f.name));
  if (kind === 'dock' && !used.has('dock')) return 'dock';
  for (let n = 1; ; n++) {
    const name = `${prefix}${n}`;
    if (!used.has(name)) return name;
  }
};

/** dock, dock1, dock2, ...: the names a robot recognises a dock by. */
export const nextDockName = (features: MapFeature[]): string => nextName('dock', features, 'dock');

/** route1, route2, ... */
export const nextRouteName = (features: MapFeature[]): string =>
  nextName('route', features, 'route');

export const nearestNode = (
  point: LatLng,
  nodes: NamedNode[],
  maxMetres = SNAP_DISTANCE_M,
): NamedNode | null => {
  let best: NamedNode | null = null;
  let bestDistance = maxMetres;
  for (const node of nodes) {
    const d = distanceBetween(point, node);
    if (d <= bestDistance) {
      best = node;
      bestDistance = d;
    }
  }
  return best;
};

/** Row nodes (F1R0N0, ...) of a collection of rows, as named points. */
export const rowNodesOf = (
  collection: {
    features?: {
      properties?: Record<string, any>;
      geometry?: { coordinates?: number[][] };
    }[];
  } | null,
): NamedNode[] =>
  (collection?.features ?? [])
    .filter((f) => f.properties?.role === 'row')
    .flatMap((f) => {
      const names: string[] | undefined = f.properties?.node_names;
      return (f.geometry?.coordinates ?? []).flatMap(([lng, lat], i) =>
        names?.[i] ? [{ name: names[i], lat, lng }] : [],
      );
    });

export const dockNodesOf = (features: MapFeature[]): NamedNode[] =>
  features.flatMap((f) => (f.kind === 'dock' ? [{ name: f.name, ...f.points[0] }] : []));

export type RouteResult = { route: RouteFeature } | { error: 'TOO_FEW_POINTS' | 'START' | 'END' };

/**
 * Turn clicked points into a route. The first and last point snap to the nearest node, which is what the route
 * joins, so a route is drawn from one node to another and its waypoints are the clicks in between.
 */
export const buildRoute = (name: string, clicks: LatLng[], nodes: NamedNode[]): RouteResult => {
  if (clicks.length < 2) return { error: 'TOO_FEW_POINTS' };
  const start = nearestNode(clicks[0], nodes);
  if (!start) return { error: 'START' };
  const end = nearestNode(clicks[clicks.length - 1], nodes);
  if (!end || end.name === start.name) return { error: 'END' };
  const points = [
    { lat: start.lat, lng: start.lng },
    ...clicks.slice(1, -1),
    { lat: end.lat, lng: end.lng },
  ];
  return { route: { kind: 'route', name, points, from_node: start.name, to_node: end.name } };
};

/** What the api takes: nothing but the fields it knows. */
export const toApiFeatures = (features: MapFeature[]) =>
  features.map((f) =>
    f.kind === 'dock'
      ? { kind: f.kind, name: f.name, points: f.points, heading_deg: f.heading_deg ?? null }
      : {
          kind: f.kind,
          name: f.name,
          points: f.points,
          from_node: f.from_node,
          to_node: f.to_node,
        },
  );

/** Features as GeoJSON for the map: docks as points, routes as lines and their waypoints as points. */
export const featuresToCollection = (features: MapFeature[]) => ({
  type: 'FeatureCollection' as const,
  features: features.flatMap((f) => {
    if (f.kind === 'dock') {
      return [
        {
          type: 'Feature' as const,
          properties: { role: 'dock', name: f.name, heading: f.heading_deg ?? 0 },
          geometry: { type: 'Point' as const, coordinates: [f.points[0].lng, f.points[0].lat] },
        },
      ];
    }
    return [
      {
        type: 'Feature' as const,
        properties: { role: 'route', name: f.name },
        geometry: {
          type: 'LineString' as const,
          coordinates: f.points.map((p) => [p.lng, p.lat]),
        },
      },
      ...f.points.slice(1, -1).map((p) => ({
        type: 'Feature' as const,
        properties: { role: 'waypoint', name: f.name },
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      })),
    ];
  }),
});

/** Remove a feature. Removing a dock also removes the routes that join it, as they would have no end. */
export const removeFeature = (features: MapFeature[], name: string): MapFeature[] =>
  features.filter(
    (f) => f.name !== name && !(f.kind === 'route' && (f.from_node === name || f.to_node === name)),
  );
