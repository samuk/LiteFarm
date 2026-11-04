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

// Row plans: parsing, hashing and export of the shared rows.geojson format.
//
// The format is the Sowbot web planner's swaths.geojson (schema version 1) with optional extra properties.
// GeoJSON coordinates are [lon, lat]; LiteFarm stores line points as { lat, lng }.
// Pure functions only, so the station, the robot and LiteFarm can share test vectors.

import { createHash } from 'node:crypto';

export class RowPlanError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RowPlanError';
    this.status = status;
  }
}

export const SCHEMA_VERSION = 1;
export const MAX_ROWS = 2000;
export const MAX_POINTS_PER_ROW = 5000;
export const MAX_BYTES = 5_000_000;
// How far a row vertex may sit outside the field polygon. Field outlines are hand-drawn, so allow some slack.
export const FIELD_TOLERANCE_M = 5;

const EARTH_RADIUS_M = 6_371_008.8;
const MAP_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

const isInt = (v) => Number.isInteger(v) && v >= 0;
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

const checkLatLng = (lat, lng, what) => {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    throw new RowPlanError(`${what}: not a finite number`);
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new RowPlanError(`${what}: coordinate out of range`);
  }
};

export const distanceMetres = (a, b) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

export const lineLengthMetres = (points) =>
  points.slice(1).reduce((sum, p, i) => sum + distanceMetres(points[i], p), 0);

/**
 * Names for rows and nodes: F<field>R<row>N<node>, for example F1R12N3 is node 3 of row 12 in field 1.
 * Nodes are numbered from 0 along each row. A row split by an obstacle keeps counting through its fragments
 * in fragment order, so every node name in a field is unique.
 */
export const rowName = (fieldNumber, rowNumber) => `F${fieldNumber}R${rowNumber}`;
export const nodeName = (fieldNumber, rowNumber, node) => `${rowName(fieldNumber, rowNumber)}N${node}`;

/** Map of `${row_number}/${frag}` to the number of the fragment's first node. */
export const nodeStarts = (rows) => {
  const starts = new Map();
  const used = new Map();
  [...rows]
    .sort((a, b) => a.row_number - b.row_number || a.frag - b.frag)
    .forEach((r) => {
      const start = used.get(r.row_number) ?? 0;
      starts.set(`${r.row_number}/${r.frag}`, start);
      used.set(r.row_number, start + r.line_points.length);
    });
  return starts;
};

/**
 * Parse and validate a rows.geojson document (object or JSON text).
 * Returns { properties, rows } where rows are in mission order:
 *   { row_number, frag, position, line_points: [{ lat, lng }], length }
 * Throws RowPlanError with a reason that is safe to show to the user.
 */
export const parseRowPlanGeoJSON = (input) => {
  let doc = input;
  if (typeof input === 'string') {
    if (input.length > MAX_BYTES) throw new RowPlanError('file too large');
    try {
      doc = JSON.parse(input);
    } catch (e) {
      throw new RowPlanError(`not valid JSON: ${e.message}`);
    }
  }
  if (!doc || typeof doc !== 'object' || doc.type !== 'FeatureCollection') {
    throw new RowPlanError('not a GeoJSON FeatureCollection');
  }
  const props = doc.properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    throw new RowPlanError('missing top-level properties');
  }
  if (props.version !== SCHEMA_VERSION) {
    throw new RowPlanError(`unsupported plan version ${JSON.stringify(props.version)}`);
  }
  if (Array.isArray(props.fields)) {
    throw new RowPlanError('this file holds more than one field: import one field at a time');
  }
  if (!Array.isArray(props.origin) || props.origin.length !== 2) {
    throw new RowPlanError('origin must be [lat, lon]');
  }
  checkLatLng(props.origin[0], props.origin[1], 'origin');

  const hasMapId = props.map_id !== undefined && props.map_id !== null;
  const hasMapHash = props.map_hash !== undefined && props.map_hash !== null;
  if (hasMapId !== hasMapHash) {
    throw new RowPlanError('map_id and map_hash must be given together');
  }
  let source = props.source;
  if (source === undefined) source = hasMapId ? 'robot' : 'in_app';
  if (source !== 'in_app' && source !== 'robot') {
    throw new RowPlanError('source must be in_app or robot');
  }
  if (source === 'robot' && !hasMapId) {
    throw new RowPlanError('a robot plan needs map_id and map_hash');
  }
  if (source === 'in_app' && hasMapId) {
    throw new RowPlanError('an in_app plan must not have a map_id');
  }
  if (hasMapId && !MAP_ID_PATTERN.test(String(props.map_id))) {
    throw new RowPlanError(
      'map_id may only use letters, digits and . _ : - (up to 100 characters)',
    );
  }
  if (hasMapHash && !HASH_PATTERN.test(String(props.map_hash))) {
    throw new RowPlanError('map_hash must be 64 lower-case hex characters');
  }
  if (props.inputs_hash != null && !HASH_PATTERN.test(String(props.inputs_hash))) {
    throw new RowPlanError('inputs_hash must be 64 lower-case hex characters');
  }
  if (props.supersedes != null && !MAP_ID_PATTERN.test(String(props.supersedes))) {
    throw new RowPlanError('supersedes must be a map_id');
  }
  for (const key of ['snake', 'contour']) {
    if (props[key] != null && typeof props[key] !== 'boolean') {
      throw new RowPlanError(`${key} must be a boolean`);
    }
  }
  for (const key of ['tool_width', 'angle', 'headland']) {
    if (props[key] != null && !isFiniteNumber(props[key])) {
      throw new RowPlanError(`${key} must be a number`);
    }
  }

  const rows = [];
  const seen = new Set();
  const fieldsInFile = new Set();
  (Array.isArray(doc.features) ? doc.features : []).forEach((feature, i) => {
    if (feature?.properties?.role !== 'row') return;
    // Names such as F1R12 are generated on export. The field number in a file is not trusted on import: the
    // server numbers the field. A file that mixes fields cannot be one field's plan.
    if (feature.properties.field != null) fieldsInFile.add(feature.properties.field);
    if (fieldsInFile.size > 1) {
      throw new RowPlanError('this file holds more than one field: import one field at a time');
    }
    const geometry = feature.geometry;
    if (geometry?.type !== 'LineString')
      throw new RowPlanError(`feature ${i}: row is not a LineString`);
    const coords = geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2 || coords.length > MAX_POINTS_PER_ROW) {
      throw new RowPlanError(`feature ${i}: bad point count`);
    }
    const row = feature.properties.row;
    if (!isInt(row)) throw new RowPlanError(`feature ${i}: row must be a non-negative integer`);
    const frag = feature.properties.frag ?? 0;
    if (!isInt(frag)) throw new RowPlanError(`feature ${i}: frag must be a non-negative integer`);
    const key = `${row}/${frag}`;
    if (seen.has(key))
      throw new RowPlanError(`feature ${i}: row ${row} fragment ${frag} appears twice`);
    seen.add(key);
    const line_points = coords.map((c, j) => {
      if (!Array.isArray(c) || c.length < 2) {
        throw new RowPlanError(`feature ${i}: point ${j} is not a position`);
      }
      checkLatLng(c[1], c[0], `feature ${i}`);
      return { lat: c[1], lng: c[0] };
    });
    rows.push({
      row_number: row,
      frag,
      position: rows.length,
      line_points,
      length: Math.round(lineLengthMetres(line_points) * 100) / 100,
    });
    if (rows.length > MAX_ROWS) throw new RowPlanError(`more than ${MAX_ROWS} rows`);
  });
  if (!rows.length) throw new RowPlanError('no rows in plan');

  return {
    properties: {
      source,
      map_id: hasMapId ? String(props.map_id) : null,
      map_hash: hasMapHash ? String(props.map_hash) : null,
      inputs_hash: props.inputs_hash ?? null,
      supersedes: props.supersedes ?? null,
      field_location_id: props.field_location_id ?? null,
      generator: props.generator == null ? null : String(props.generator).slice(0, 255),
      origin: { lat: props.origin[0], lng: props.origin[1] },
      params: {
        tool_width: props.tool_width ?? null,
        angle: props.angle ?? null,
        headland: props.headland ?? null,
        snake: props.snake ?? null,
        contour: props.contour ?? null,
      },
    },
    rows,
  };
};

// A coordinate as text with exactly 7 decimals. The exact binary value is rounded half away from zero, which is
// what JavaScript's toFixed does and what Python gets from Decimal(x).quantize(Decimal('1e-7'), ROUND_HALF_UP).
export const formatCoordinate = (value) => {
  const text = value.toFixed(7);
  return text === '-0.0000000' ? '0.0000000' : text;
};

/**
 * Canonical text of a set of rows, in mission order, with no whitespace:
 *   [[row,frag,[[lon,lat],...]],...]
 * Numbers are written by hand (not JSON.stringify) so the text is the same in every language.
 */
export const canonicalRowsText = (rows) =>
  `[${[...rows]
    .sort((a, b) => a.position - b.position)
    .map((r) => {
      const points = r.line_points.map(
        (p) => `[${formatCoordinate(p.lng)},${formatCoordinate(p.lat)}]`,
      );
      return `[${r.row_number},${r.frag},[${points.join(',')}]]`;
    })
    .join(',')}]`;

/** SHA-256 of the canonical text, lower-case hex. Covers geometry and order only, not map_id. */
export const computeMapHash = (rows) =>
  createHash('sha256').update(canonicalRowsText(rows), 'utf8').digest('hex');

// Local planar projection in metres, good enough for a field.
const projector = (origin) => {
  const kLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const kLng = kLat * Math.cos((origin.lat * Math.PI) / 180);
  return (p) => [(p.lng - origin.lng) * kLng, (p.lat - origin.lat) * kLat];
};

const insidePolygon = ([x, y], poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const distanceToSegment = ([px, py], [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/**
 * Row numbers with any vertex further than toleranceM outside the field.
 * ring: [{ lat, lng }, ...] (the field's grid_points).
 */
export const rowsOutsideField = (rows, ring, toleranceM = FIELD_TOLERANCE_M) => {
  if (!Array.isArray(ring) || ring.length < 3) return [];
  const project = projector(ring[0]);
  const poly = ring.map(project);
  const outside = new Set();
  for (const row of rows) {
    for (const p of row.line_points) {
      const xy = project(p);
      if (insidePolygon(xy, poly)) continue;
      let nearest = Infinity;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        nearest = Math.min(nearest, distanceToSegment(xy, poly[j], poly[i]));
      }
      if (nearest > toleranceM) {
        outside.add(row.row_number);
        break;
      }
    }
  }
  return [...outside].sort((a, b) => a - b);
};

/**
 * Parse a row selection such as "12-18,21" into sorted unique row numbers.
 * Same grammar as the station reads from task notes while there is no task-row link.
 */
export const parseRowSpec = (text) => {
  if (typeof text !== 'string' || !text.trim()) throw new RowPlanError('empty row selection');
  const numbers = new Set();
  for (const part of text.split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) throw new RowPlanError(`cannot read "${part.trim()}" as a row or range`);
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (to < from) throw new RowPlanError(`range ${from}-${to} runs backwards`);
    if (to - from >= MAX_ROWS) throw new RowPlanError('range is too long');
    for (let n = from; n <= to; n++) numbers.add(n);
    if (numbers.size > MAX_ROWS) throw new RowPlanError(`more than ${MAX_ROWS} rows selected`);
  }
  return [...numbers].sort((a, b) => a - b);
};

const planProperties = (plan) => {
  const origin = plan.origin ?? {};
  const params = plan.params ?? {};
  const properties = {
    version: SCHEMA_VERSION,
    generator: plan.generator ?? 'litefarm',
    source: plan.source,
  };
  if (origin.lat !== undefined) properties.origin = [origin.lat, origin.lng];
  for (const key of ['tool_width', 'angle', 'headland', 'snake', 'contour']) {
    if (params[key] !== null && params[key] !== undefined) properties[key] = params[key];
  }
  if (plan.map_id) properties.map_id = plan.map_id;
  if (plan.map_hash) properties.map_hash = plan.map_hash;
  if (plan.inputs_hash) properties.inputs_hash = plan.inputs_hash;
  if (plan.supersedes_map_id) properties.supersedes = plan.supersedes_map_id;
  properties.field_location_id = plan.location_id;
  properties.row_plan_id = plan.row_plan_id;
  properties.field_number = plan.field_number;
  return properties;
};

const fieldFeature = (ring, properties) => {
  const closed = ring.map((p) => [p.lng, p.lat]);
  return {
    type: 'Feature',
    properties: { role: 'field', ...properties },
    geometry: { type: 'Polygon', coordinates: [[...closed, closed[0]]] },
  };
};

const rowFeatures = (plan, rows) => {
  const starts = nodeStarts(rows);
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((r) => {
      const start = starts.get(`${r.row_number}/${r.frag}`);
      return {
        type: 'Feature',
        properties: {
          role: 'row',
          row: r.row_number,
          frag: r.frag,
          row_id: r.row_id,
          name: rowName(plan.field_number, r.row_number),
          field: plan.field_number,
          location_id: plan.location_id,
          node_start: start,
          node_names: r.line_points.map((_, i) => nodeName(plan.field_number, r.row_number, start + i)),
          length_m: Number(r.length),
        },
        geometry: { type: 'LineString', coordinates: r.line_points.map((p) => [p.lng, p.lat]) },
      };
    });
};

/**
 * Build the export document for one plan.
 * plan: row_plan record; rows: field_row records; fieldRing: [{ lat, lng }] or null.
 * Coordinates are written exactly as stored, so a robot plan keeps its map_hash on re-import.
 * Rows are named F<field>R<row> and each carries node_names F<field>R<row>N<node>.
 */
export const buildRowPlanGeoJSON = (plan, rows, fieldRing = null) => {
  const features = [];
  if (Array.isArray(fieldRing) && fieldRing.length >= 3) {
    features.push(fieldFeature(fieldRing, { field: plan.field_number }));
  }
  features.push(...rowFeatures(plan, rows));
  return { type: 'FeatureCollection', properties: planProperties(plan), features };
};

/**
 * Build one document holding the current plan of every field, for export from the farm map.
 * entries: [{ plan, rows, name, ring }] where name is the field's name and ring its outline ([{ lat, lng }] or null).
 * The top-level properties list the fields; a file like this is not one field's plan, so it cannot be imported back.
 * numbering: { fieldNumbers: { [location_id]: number } for every field ever planned, nextFieldNumber }. Without it
 * both come from the entries.
 */
export const buildFarmRowPlanGeoJSON = (entries, numbering = {}) => {
  const sorted = [...entries].sort((a, b) => a.plan.field_number - b.plan.field_number);
  const features = [];
  const fields = sorted.map(({ plan, rows, name, ring }) => {
    if (Array.isArray(ring) && ring.length >= 3) {
      features.push(
        fieldFeature(ring, {
          field: plan.field_number,
          location_id: plan.location_id,
          field_name: name ?? null,
        }),
      );
    }
    features.push(...rowFeatures(plan, rows));
    const { version, ...summary } = planProperties(plan);
    return {
      ...summary,
      field_name: name ?? null,
      row_count: new Set(rows.map((r) => r.row_number)).size,
    };
  });
  const fieldNumbers =
    numbering.fieldNumbers ??
    Object.fromEntries(sorted.map(({ plan }) => [plan.location_id, plan.field_number]));
  const nextFieldNumber =
    numbering.nextFieldNumber ?? Math.max(0, ...Object.values(fieldNumbers)) + 1;
  return {
    type: 'FeatureCollection',
    properties: {
      version: SCHEMA_VERSION,
      generator: 'litefarm',
      multi_field: true,
      fields,
      field_numbers: fieldNumbers,
      next_field_number: nextFieldNumber,
    },
    features,
  };
};
