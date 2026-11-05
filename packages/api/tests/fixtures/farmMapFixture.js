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

/**
 * A small published farm map for tests, and for the robot side to check its importer against:
 * farm-map.geojson is the export of this data, so the file and the code cannot drift apart.
 *   field 1: row 0, a row split by an obstacle (row 1, two fragments) and a contour row with four vertices
 *   field 2: two straight rows, with different parameters from field 1
 */
const point = (lat, lng) => ({ lat, lng });

const row = (row_id, row_number, frag, position, line_points) => ({
  row_id,
  row_number,
  frag,
  position,
  line_points,
  length: 10,
});

const planRecord = (props) => ({
  generator: 'litefarm-row-planner',
  source: 'in_app',
  map_id: null,
  map_hash: null,
  inputs_hash: null,
  supersedes_map_id: null,
  ...props,
});

const field1 = planRecord({
  row_plan_id: '11111111-1111-4111-8111-111111111111',
  location_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  field_number: 1,
  origin: { lat: 48.004066, lng: 3.661831 },
  params: { tool_width: 5, angle: 0, headland: 0, snake: true, contour: true },
});

const field2 = planRecord({
  row_plan_id: '22222222-2222-4222-8222-222222222222',
  location_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  field_number: 2,
  origin: { lat: 48.005924, lng: 3.66394 },
  params: { tool_width: 25, angle: 90, headland: 0, snake: true, contour: false },
});

const ring = (lat, lng) => [
  point(lat, lng),
  point(lat, lng + 0.002),
  point(lat + 0.001, lng + 0.002),
  point(lat + 0.001, lng),
];

export const farmMapFixture = {
  entries: [
    {
      plan: field1,
      field_number: 1,
      name: 'North field',
      ring: ring(48.004, 3.6618),
      rows: [
        row('f1000000-0000-4000-8000-000000000000', 0, 0, 0, [
          point(48.0041, 3.6619),
          point(48.0041, 3.6624),
        ]),
        row('f1000000-0000-4000-8000-000000000001', 1, 0, 1, [
          point(48.00415, 3.6624),
          point(48.00415, 3.6621),
        ]),
        row('f1000000-0000-4000-8000-000000000002', 1, 1, 2, [
          point(48.00415, 3.662),
          point(48.00415, 3.6619),
        ]),
        row('f1000000-0000-4000-8000-000000000003', 2, 0, 3, [
          point(48.0042, 3.6619),
          point(48.00422, 3.6621),
          point(48.00421, 3.6623),
          point(48.0042, 3.6624),
        ]),
      ],
    },
    {
      plan: field2,
      field_number: 2,
      name: 'South field',
      ring: ring(48.0059, 3.6639),
      rows: [
        row('f2000000-0000-4000-8000-000000000000', 0, 0, 0, [
          point(48.006, 3.664),
          point(48.006, 3.6645),
        ]),
        row('f2000000-0000-4000-8000-000000000001', 1, 0, 1, [
          point(48.00605, 3.6645),
          point(48.00605, 3.664),
        ]),
      ],
    },
  ],
  numbering: {
    fieldNumbers: { [field1.location_id]: 1, [field2.location_id]: 2 },
    nextFieldNumber: 3,
  },
  farmMap: {
    farm_map_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    version: 2,
    name: 'Map 2027',
    season: '2027',
    status: 'published',
    previous_farm_map_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    published_at: '2027-02-01T09:00:00.000Z',
  },
};
