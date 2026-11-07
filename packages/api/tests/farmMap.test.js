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
import mocks from './mock.factories.js';
import { setupFarmEnvironment, createField } from './utils/testDataSetup.js';
import { computeFarmMapHash } from '../src/util/rowPlan.js';

jest.mock('jsdom');
jest.mock('../src/middleware/acl/checkJwt.js', () =>
  jest.fn((req, _res, next) => {
    req.auth = {};
    req.auth.user_id = req.get('user_id');
    next();
  }),
);

const request = (method, path, { user, farm }, body, extraHeaders = {}) => {
  const req = chai
    .request(server)
    [method](path)
    .set('user_id', user.user_id)
    .set('farm_id', farm.farm_id);
  Object.entries(extraHeaders).forEach(([k, v]) => req.set(k, v));
  return body === undefined ? req : req.send(body);
};

// Rows are LineStrings of [lon, lat]. Rows outside the field only give a warning for an in-app plan.
const plan = ({ rows = 2, lat = 48.0, lng = 3.66 } = {}) => ({
  type: 'FeatureCollection',
  properties: { version: 1, generator: 'test', origin: [lat, lng], tool_width: 5 },
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

const createMap = (auth, body = {}) =>
  request('post', '/farm_map', auth, { farm_id: auth.farm.farm_id, name: 'Map 2026', ...body });

describe('Farm maps', () => {
  let env;
  let fieldB;
  let planA;
  let planB;

  beforeEach(async () => {
    env = await setupFarmEnvironment(1);
    fieldB = await createField(env.farm);
    planA = (await importPlan(env, env.field.location_id)).body.row_plan;
    planB = (await importPlan(env, fieldB.location_id, plan({ rows: 3, lat: 48.01 }))).body
      .row_plan;
  });

  afterAll(async () => {
    await tableCleanup(knex);
    await knex.destroy();
  });

  describe('Drafts', () => {
    test('A draft holds the current plan of every field and starts at version 1', async () => {
      const res = await createMap(env, { season: '2026' });
      expect(res.status).toBe(201);
      expect(res.body.farm_map).toMatchObject({ status: 'draft', version: 1, season: '2026' });
      expect(res.body.farm_map.previous_farm_map_id).toBeNull();
      expect(res.body.plans.map((p) => p.field_number)).toEqual([1, 2]);
      expect(res.body.plans.map((p) => p.row_count)).toEqual([2, 3]);
    });

    test('A draft can be given chosen plans, but never two plans for one field', async () => {
      const one = await createMap(env, { row_plan_ids: [planA.row_plan_id] });
      expect(one.body.plans).toHaveLength(1);
      const replan = (
        await importPlan(env, env.field.location_id, plan({ rows: 4 }), {
          supersedes_row_plan_id: planA.row_plan_id,
        })
      ).body.row_plan;
      const stale = await createMap(env, { row_plan_ids: [planA.row_plan_id] });
      expect(stale.status).toBe(409);
      const swapped = await request(
        'put',
        `/farm_map/${one.body.farm_map.farm_map_id}/plans`,
        env,
        {
          row_plan_ids: [replan.row_plan_id, planB.row_plan_id],
        },
      );
      expect(swapped.status).toBe(200);
      expect(swapped.body.plans.map((p) => p.row_plan_id)).toEqual([
        replan.row_plan_id,
        planB.row_plan_id,
      ]);

      // A second plan made for field B without replacing the first leaves two current plans for that field.
      const other = (await importPlan(env, fieldB.location_id, plan({ rows: 1, lat: 48.02 }))).body
        .row_plan;
      const both = await request('put', `/farm_map/${one.body.farm_map.farm_map_id}/plans`, env, {
        row_plan_ids: [planB.row_plan_id, other.row_plan_id],
      });
      expect(both.status).toBe(400);
      expect(both.body.error).toMatch(/one plan for each field/);
    });

    test('Bad input is refused', async () => {
      expect((await createMap(env, { name: '' })).status).toBe(400);
      expect((await createMap(env, { row_plan_ids: ['nope'] })).status).toBe(400);
      expect((await createMap(env, { row_plan_ids: [] })).status).toBe(400);
    });

    test('A draft cannot be exported, and can be deleted', async () => {
      const { farm_map } = (await createMap(env)).body;
      expect((await request('get', `/farm_map/${farm_map.farm_map_id}/geojson`, env)).status).toBe(
        409,
      );
      expect((await request('delete', `/farm_map/${farm_map.farm_map_id}`, env)).status).toBe(204);
      expect((await request('get', `/farm_map/${farm_map.farm_map_id}`, env)).status).toBe(404);
    });
  });

  describe('Publishing', () => {
    test('Publishing records the hash of the rows and the export names the map', async () => {
      const { farm_map } = (await createMap(env)).body;
      const published = await request('post', `/farm_map/${farm_map.farm_map_id}/publish`, env);
      expect(published.status).toBe(200);
      expect(published.body.status).toBe('published');

      const rows = await knex('field_row').whereIn('row_plan_id', [
        planA.row_plan_id,
        planB.row_plan_id,
      ]);
      const expected = computeFarmMapHash([
        { field_number: 1, rows: rows.filter((r) => r.row_plan_id === planA.row_plan_id) },
        { field_number: 2, rows: rows.filter((r) => r.row_plan_id === planB.row_plan_id) },
      ]);
      expect(published.body.content_hash).toBe(expected);

      const res = await request('get', `/farm_map/${farm_map.farm_map_id}/geojson`, env);
      expect(res.status).toBe(200);
      expect(res.body.properties).toMatchObject({
        multi_field: true,
        farm_map_id: farm_map.farm_map_id,
        farm_map_version: 1,
        content_hash: expected,
        status: 'published',
      });
      const rowFeatures = res.body.features.filter((f) => f.properties.role === 'row');
      expect(rowFeatures).toHaveLength(5);
      expect(rowFeatures.every((f) => f.properties.farm_map_id === farm_map.farm_map_id)).toBe(
        true,
      );
      expect(rowFeatures.map((f) => f.properties.name)).toEqual([
        'F1R0',
        'F1R1',
        'F2R0',
        'F2R1',
        'F2R2',
      ]);
    });

    test('The published map can be fetched by farm, and a robot can ask if it changed', async () => {
      expect(
        (await request('get', `/farm_map/farm/${env.farm.farm_id}/published/geojson`, env)).status,
      ).toBe(404);
      const { farm_map } = (await createMap(env)).body;
      const { body } = await request('post', `/farm_map/${farm_map.farm_map_id}/publish`, env);
      const res = await request('get', `/farm_map/farm/${env.farm.farm_id}/published/geojson`, env);
      expect(res.status).toBe(200);
      expect(res.headers.etag).toBe(`"${body.content_hash}"`);
      const same = await request(
        'get',
        `/farm_map/farm/${env.farm.farm_id}/published/geojson`,
        env,
        undefined,
        { 'If-None-Match': res.headers.etag },
      );
      expect(same.status).toBe(304);
    });

    test('A plan replaced after the draft was made stops it being published', async () => {
      const { farm_map } = (await createMap(env)).body;
      await importPlan(env, env.field.location_id, plan({ rows: 4 }), {
        supersedes_row_plan_id: planA.row_plan_id,
      });
      const res = await request('post', `/farm_map/${farm_map.farm_map_id}/publish`, env);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/field 1/);
    });

    test('A published map is frozen: its plans cannot be replaced, deleted or swapped', async () => {
      const { farm_map } = (await createMap(env)).body;
      await request('post', `/farm_map/${farm_map.farm_map_id}/publish`, env);

      const replace = await importPlan(env, env.field.location_id, plan({ rows: 4 }), {
        supersedes_row_plan_id: planA.row_plan_id,
      });
      expect(replace.status).toBe(409);
      expect(replace.body.error).toMatch(/published farm map/);
      expect((await request('delete', `/row_plan/${planA.row_plan_id}`, env)).status).toBe(409);
      expect(
        (
          await request('put', `/farm_map/${farm_map.farm_map_id}/plans`, env, {
            row_plan_ids: [planA.row_plan_id],
          })
        ).status,
      ).toBe(409);
      expect((await request('post', `/farm_map/${farm_map.farm_map_id}/publish`, env)).status).toBe(
        409,
      );
      expect((await request('delete', `/farm_map/${farm_map.farm_map_id}`, env)).status).toBe(409);

      // The same holds when something writes to the database directly.
      await expect(
        knex('row_plan').where({ row_plan_id: planA.row_plan_id }).update({ deleted: true }),
      ).rejects.toThrow(/published farm map/);
      await expect(
        knex('row_plan')
          .where({ row_plan_id: planA.row_plan_id })
          .update({ superseded_at: new Date() }),
      ).rejects.toThrow(/published farm map/);
      await expect(
        knex('farm_map_row_plan').where({ farm_map_id: farm_map.farm_map_id }).del(),
      ).rejects.toThrow(/cannot change/);
    });

    test('A new version retires the old one, and a farm never has two published maps', async () => {
      const first = (await createMap(env)).body.farm_map;
      await request('post', `/farm_map/${first.farm_map_id}/publish`, env);
      const second = (await createMap(env, { name: 'Map 2027' })).body.farm_map;
      expect(second.version).toBe(2);
      expect(second.previous_farm_map_id).toBe(first.farm_map_id);

      await request('post', `/farm_map/${second.farm_map_id}/publish`, env);
      const list = (await request('get', `/farm_map/farm/${env.farm.farm_id}`, env)).body;
      expect(list.map((m) => [m.version, m.status, m.plan_count])).toEqual([
        [2, 'published', 2],
        [1, 'retired', 2],
      ]);

      await expect(
        knex('farm_map').where({ farm_map_id: first.farm_map_id }).update({ status: 'published' }),
      ).rejects.toThrow(/one_published_per_farm/);
    });

    test('Retiring releases the plans, and the retired map still exports the same rows', async () => {
      const { farm_map } = (await createMap(env)).body;
      const { body } = await request('post', `/farm_map/${farm_map.farm_map_id}/publish`, env);
      expect((await request('post', `/farm_map/${farm_map.farm_map_id}/retire`, env)).status).toBe(
        200,
      );
      expect((await request('post', `/farm_map/${farm_map.farm_map_id}/retire`, env)).status).toBe(
        409,
      );
      const replace = await importPlan(env, env.field.location_id, plan({ rows: 4 }), {
        supersedes_row_plan_id: planA.row_plan_id,
      });
      expect(replace.status).toBe(201);

      const res = await request('get', `/farm_map/${farm_map.farm_map_id}/geojson`, env);
      expect(res.body.properties).toMatchObject({
        status: 'retired',
        content_hash: body.content_hash,
      });
      expect(res.body.features.filter((f) => f.properties.role === 'row')).toHaveLength(5);
    });
  });

  describe('Docks and routes', () => {
    // Row 0 of field 1 starts at lat 48.0, lng 3.66 (see plan()).
    const dock = {
      kind: 'dock',
      name: 'dock',
      points: [{ lat: 47.9999, lng: 3.6599 }],
      heading_deg: 90,
    };
    const route = {
      kind: 'route',
      name: 'dock_to_f1',
      from_node: 'dock',
      to_node: 'F1R0N0',
      points: [
        { lat: 47.9999, lng: 3.6599 },
        { lat: 47.99995, lng: 3.65995 },
        { lat: 48.0, lng: 3.66 },
      ],
    };
    const setFeatures = (map, features) =>
      request('put', `/farm_map/${map.farm_map_id}/features`, env, { features });

    test('A draft takes docks and routes, and the map returns them', async () => {
      const { farm_map } = (await createMap(env)).body;
      const res = await setFeatures(farm_map, [dock, route]);
      expect(res.status).toBe(200);
      expect(res.body.features.map((f) => f.name)).toEqual(['dock', 'dock_to_f1']);
      const got = await request('get', `/farm_map/${farm_map.farm_map_id}`, env);
      expect(got.body.features).toHaveLength(2);
      expect((await setFeatures(farm_map, [])).body.features).toEqual([]);
    });

    test('A route to a node that is not there, or drawn away from it, is refused', async () => {
      const { farm_map } = (await createMap(env)).body;
      const nowhere = await setFeatures(farm_map, [dock, { ...route, to_node: 'F7R0N0' }]);
      expect(nowhere.status).toBe(400);
      const far = await setFeatures(farm_map, [
        dock,
        { ...route, points: [route.points[0], { lat: 48.01, lng: 3.67 }] },
      ]);
      expect(far.status).toBe(400);
      expect(far.body.error).toMatch(/10 m/);
    });

    test('Publishing covers the docks and routes in the hash, and the export carries them', async () => {
      const { farm_map } = (await createMap(env)).body;
      await setFeatures(farm_map, [dock, route]);
      const published = await request('post', `/farm_map/${farm_map.farm_map_id}/publish`, env);
      expect(published.status).toBe(200);
      const exported = await request('get', `/farm_map/${farm_map.farm_map_id}/geojson`, env);
      const roles = exported.body.features.map((f) => f.properties.role);
      expect(roles.filter((r) => r === 'dock')).toHaveLength(1);
      expect(roles.filter((r) => r === 'route')).toHaveLength(1);
      expect(published.body.content_hash).toMatch(/^[0-9a-f]{64}$/);
      const bare = await createMap(env);
      const bareHash = (
        await request('post', `/farm_map/${bare.body.farm_map.farm_map_id}/publish`, env)
      ).body.content_hash;
      expect(bareHash).not.toBe(published.body.content_hash);
    });

    test('A published map cannot have its docks changed', async () => {
      const { farm_map } = (await createMap(env)).body;
      await setFeatures(farm_map, [dock]);
      await request('post', `/farm_map/${farm_map.farm_map_id}/publish`, env);
      expect((await setFeatures(farm_map, [])).status).toBe(409);
      await expect(
        knex('farm_map_feature').where({ farm_map_id: farm_map.farm_map_id }).del(),
      ).rejects.toThrow(/cannot change/);
    });

    test('Swapping the plans so that a route loses its node stops publishing', async () => {
      const { farm_map } = (await createMap(env)).body;
      await setFeatures(farm_map, [dock, route]);
      await request('put', `/farm_map/${farm_map.farm_map_id}/plans`, env, {
        row_plan_ids: [planB.row_plan_id],
      });
      const res = await request('post', `/farm_map/${farm_map.farm_map_id}/publish`, env);
      expect(res.status).toBe(400);
    });
  });

  describe('Access', () => {
    test('Another farm is refused, and a worker can read maps but not change them', async () => {
      const outsider = await setupFarmEnvironment(1);
      const { farm_map } = (await createMap(env)).body;
      // The outsider claims their own farm in the header, so the map is not theirs to read.
      const asOutsider = { user: outsider.user, farm: outsider.farm };
      expect((await request('get', `/farm_map/${farm_map.farm_map_id}`, asOutsider)).status).toBe(
        403,
      );

      const [member] = await mocks.usersFactory();
      await mocks.userFarmFactory(
        { promisedUser: Promise.resolve([member]), promisedFarm: Promise.resolve([env.farm]) },
        { ...mocks.fakeUserFarm(), role_id: 3 },
      );
      const asMember = { user: member, farm: env.farm };
      expect((await request('get', `/farm_map/${farm_map.farm_map_id}`, asMember)).status).toBe(
        200,
      );
      expect((await createMap(asMember)).status).toBe(403);
      expect(
        (await request('post', `/farm_map/${farm_map.farm_map_id}/publish`, asMember)).status,
      ).toBe(403);
    });
  });
});
