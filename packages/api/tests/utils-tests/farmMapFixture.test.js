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

import fs from 'fs';
import path from 'path';
import { buildFarmRowPlanGeoJSON, computeFarmMapHash } from '../../src/util/rowPlan.js';
import { farmMapFixture } from '../fixtures/farmMapFixture.js';

const FIXTURE_FILE = path.join(__dirname, '../fixtures/farm-map.geojson');

// The hash of the fixture, written out so that another implementation (the robot's importer) can check
// itself against it. If this changes, the canonical text of a farm map has changed and every published
// map's content_hash no longer matches what a new importer computes.
const FIXTURE_HASH = 'c50f60d85849c514ef0cab4dc65b2417cd03ccb0acf624d2387c35cc77212eb8';

const build = () => {
  const { entries, numbering, farmMap } = farmMapFixture;
  const content_hash = computeFarmMapHash(entries);
  return buildFarmRowPlanGeoJSON(entries, numbering, { ...farmMap, content_hash });
};

describe('farm map fixture', () => {
  test('farm-map.geojson is the export of the fixture (UPDATE_FIXTURE=1 rewrites it)', () => {
    const doc = build();
    if (process.env.UPDATE_FIXTURE) {
      fs.writeFileSync(FIXTURE_FILE, `${JSON.stringify(doc, null, 2)}\n`);
    }
    expect(JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(doc)),
    );
  });

  test('the content hash is a fixed value and does not depend on the order entries are given in', () => {
    const { entries } = farmMapFixture;
    expect(computeFarmMapHash(entries)).toBe(FIXTURE_HASH);
    expect(computeFarmMapHash([...entries].reverse())).toBe(FIXTURE_HASH);
  });

  test('the hash changes with a row, a field number or a vertex, but not with a field name or parameter', () => {
    const { entries } = farmMapFixture;
    const base = computeFarmMapHash(entries);
    const moved = structuredClone(entries);
    moved[0].rows[3].line_points[1].lat += 0.0000001;
    expect(computeFarmMapHash(moved)).not.toBe(base);
    const renumbered = structuredClone(entries);
    renumbered[1].field_number = 3;
    expect(computeFarmMapHash(renumbered)).not.toBe(base);
    const renamed = structuredClone(entries);
    renamed[0].name = 'Other';
    renamed[0].plan.params.tool_width = 9;
    expect(computeFarmMapHash(renamed)).toBe(base);
  });

  test('rows are named by field and row, and node names continue through fragments', () => {
    const doc = build();
    const rows = doc.features.filter((f) => f.properties.role === 'row');
    expect(rows.map((f) => f.properties.name)).toEqual([
      'F1R0',
      'F1R1',
      'F1R1',
      'F1R2',
      'F2R0',
      'F2R1',
    ]);
    expect(rows[1].properties.node_names).toEqual(['F1R1N0', 'F1R1N1']);
    expect(rows[2].properties.node_names).toEqual(['F1R1N2', 'F1R1N3']);
    expect(rows[3].properties.node_names).toEqual(['F1R2N0', 'F1R2N1', 'F1R2N2', 'F1R2N3']);
    expect(rows.every((f) => f.properties.farm_map_id === farmMapFixture.farmMap.farm_map_id)).toBe(
      true,
    );
  });

  test('exporting the same map twice gives identical node names', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
