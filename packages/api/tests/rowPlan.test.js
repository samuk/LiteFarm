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

import chai from 'chai';
import chaiHttp from 'chai-http';
chai.use(chaiHttp);

import server from '../src/server.js';
import knex from '../src/util/knex.js';
import { tableCleanup } from './testEnvironment.js';
import { setupFarmEnvironment, createField } from './utils/testDataSetup.js';

jest.mock('jsdom');
jest.mock('../src/middleware/acl/checkJwt.js', () =>
  jest.fn((req, _res, next) => {
    req.auth = {};
    req.auth.user_id = req.get('user_id');
    next();
  }),
);

const headers = ({ user, farm }) => ({ user_id: user.user_id, farm_id: farm.farm_id });

const request = (method, path, auth, body) => {
  const req = chai.request(server)[method](path);
  Object.entries(headers(auth)).forEach(([k, v]) => req.set(k, v));
  return body === undefined ? req : req.send(body);
};

// Rows are LineStrings of [lon, lat]. Rows outside the field only give a warning for an in-app plan.
const plan = ({ rows = 2, lat = 48.0, lng = 3.66, ...props } = {}) => ({
  type: 'FeatureCollection',
  properties: { version: 1, generator: 'test', origin: [lat, lng], tool_width: 5, ...props },
  features: Array.from({ length: rows }, (_, row) => ({
    type: 'Feature',
    properties: { role: 'row', row, frag: 0 },
    geometry: {
      type: 'LineString',
      coordinates: [
        [lng, lat + row * 0.0001],
        [lng + 0.001, lat + row * 0.0001],
      ],
    },
  })),
});

const importPlan = (auth, location_id, geojson = plan(), extra = {}) =>
  request('post', '/row_plan/import', auth, { location_id, geojson, ...extra });

describe('Row plan field numbers', () => {
  let env;
  let fieldB;

  beforeEach(async () => {
    env = await setupFarmEnvironment(1);
    fieldB = await createField(env.farm);
  });

  afterAll(async () => {
    await tableCleanup(knex);
    await knex.destroy();
  });

  test('Each field gets the next number and keeps it when replanned', async () => {
    const a = await importPlan(env, env.field.location_id);
    expect(a.status).toBe(201);
    expect(a.body.row_plan.field_number).toBe(1);

    const b = await importPlan(env, fieldB.location_id);
    expect(b.body.row_plan.field_number).toBe(2);

    const again = await importPlan(env, env.field.location_id, plan({ rows: 3 }), {
      supersedes_row_plan_id: a.body.row_plan.row_plan_id,
    });
    expect(again.status).toBe(201);
    expect(again.body.row_plan.field_number).toBe(1);
  });

  test('Two fields saved at once get different numbers', async () => {
    const [a, b] = await Promise.all([
      importPlan(env, env.field.location_id),
      importPlan(env, fieldB.location_id),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(new Set([a.body.row_plan.field_number, b.body.row_plan.field_number]).size).toBe(2);
  });

  test('The farm export lists every numbered field and the next free number', async () => {
    await importPlan(env, env.field.location_id);
    await importPlan(env, fieldB.location_id);
    const res = await request('get', `/row_plan/farm/${env.farm.farm_id}/geojson`, env);
    expect(res.status).toBe(200);
    const { field_numbers, next_field_number } = res.body.properties;
    expect(Object.values(field_numbers).sort()).toEqual([1, 2]);
    expect(next_field_number).toBe(3);
  });

  test('The database refuses a second number for a field, a reused number, and a mismatched plan', async () => {
    const a = await importPlan(env, env.field.location_id);
    const farm_id = env.farm.farm_id;
    const { location_id } = env.field;
    await expect(
      knex('row_plan_field_number').insert({ farm_id, location_id, field_number: 9 }),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      knex('row_plan_field_number').insert({
        farm_id,
        location_id: fieldB.location_id,
        field_number: 1,
      }),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      knex('row_plan')
        .where({ row_plan_id: a.body.row_plan.row_plan_id })
        .update({ field_number: 7 }),
    ).rejects.toThrow(/foreign key/);
  });
});
