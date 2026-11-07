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

import { transaction, Model, raw } from 'objection';
import FarmMapModel from '../models/farmMapModel.js';
import RowPlanModel from '../models/rowPlanModel.js';
import FieldRowModel from '../models/fieldRowModel.js';
import { getFieldAreas } from './rowPlanController.js';
import {
  RowPlanError,
  computeFarmMapHash,
  buildFarmRowPlanGeoJSON,
  validateFarmMapFeatures,
  checkRouteEnds,
} from '../util/rowPlan.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = '23505';

const sendError = (res, error) => {
  if (error instanceof RowPlanError) return res.status(error.status).json({ error: error.message });
  if (error?.nativeError?.code === UNIQUE_VIOLATION || error?.code === UNIQUE_VIOLATION) {
    return res.status(409).json({ error: 'the farm maps changed at the same time, try again' });
  }
  console.error(error);
  return res.status(500).json({ error: 'Internal server error' });
};

const getFarmMapRecord = (farm_id, farm_map_id) =>
  FarmMapModel.query().whereNotDeleted().where({ farm_id, farm_map_id }).first();

/** Two people changing a farm's maps at once could take the same version, or publish two maps. */
const lockFarmMaps = (trx, farm_id) =>
  trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`farm_map:${farm_id}`]);

/** The newest live, current plan of every field: what the farm map shows in the app today. */
const currentPlans = async (trx, farm_id) => {
  const plans = await RowPlanModel.query(trx)
    .whereNotDeleted()
    .where({ farm_id })
    .whereNull('superseded_at')
    .orderBy('created_at', 'desc');
  const newest = new Map();
  for (const plan of plans) {
    if (!newest.has(plan.location_id)) newest.set(plan.location_id, plan);
  }
  return [...newest.values()];
};

/**
 * The plans a draft will hold: the ones asked for, or the current plan of every field. Each must be a live,
 * current plan of this farm, and no two may be for the same field.
 */
const resolvePlans = async (trx, farm_id, row_plan_ids) => {
  if (row_plan_ids == null) {
    const plans = await currentPlans(trx, farm_id);
    if (!plans.length) throw new RowPlanError('the farm has no row plans to put in a map');
    return plans;
  }
  if (
    !Array.isArray(row_plan_ids) ||
    !row_plan_ids.length ||
    row_plan_ids.some((id) => !UUID_PATTERN.test(String(id)))
  ) {
    throw new RowPlanError('row_plan_ids must be a list of one or more uuids');
  }
  const ids = [...new Set(row_plan_ids)];
  const plans = await RowPlanModel.query(trx)
    .whereNotDeleted()
    .where({ farm_id })
    .whereIn('row_plan_id', ids);
  if (plans.length !== ids.length) {
    throw new RowPlanError(
      'row_plan_ids must all be plans of this farm that have not been deleted',
    );
  }
  const stale = plans.filter((plan) => plan.superseded_at);
  if (stale.length) {
    throw new RowPlanError(
      `plans have been replaced by a newer plan: ${stale.map((p) => `field ${p.field_number}`).join(', ')}`,
      409,
    );
  }
  if (new Set(plans.map((plan) => plan.location_id)).size !== plans.length) {
    throw new RowPlanError('a farm map can hold only one plan for each field');
  }
  return plans;
};

const setMembers = async (trx, farm_map_id, plans) => {
  await trx('farm_map_row_plan').where({ farm_map_id }).del();
  await trx('farm_map_row_plan').insert(
    plans.map((plan) => ({
      farm_map_id,
      row_plan_id: plan.row_plan_id,
      location_id: plan.location_id,
    })),
  );
};

const getMembers = (farm_map_id, trx = Model.knex()) =>
  trx('farm_map_row_plan as m')
    .join('row_plan as p', 'p.row_plan_id', 'm.row_plan_id')
    .where({ 'm.farm_map_id': farm_map_id })
    .orderBy('p.field_number')
    .select(
      'p.row_plan_id',
      'p.location_id',
      'p.field_number',
      'p.source',
      'p.map_id',
      trx.raw(
        '(select count(distinct r.row_number) from field_row r where r.row_plan_id = p.row_plan_id and r.deleted = false)::int as row_count',
      ),
    );

/** Docks and routes of a map, in the shape the hash and the export use. */
const getFeatures = async (farm_map_id, trx = Model.knex()) =>
  (
    await trx('farm_map_feature')
      .where({ farm_map_id })
      .orderBy([{ column: 'kind' }, { column: 'name' }])
      .select('kind', 'name', 'points', 'heading_deg', 'from_node', 'to_node')
  ).map((f) => ({ ...f, points: typeof f.points === 'string' ? JSON.parse(f.points) : f.points }));

const setFeatures = async (trx, farm_map_id, features) => {
  await trx('farm_map_feature').where({ farm_map_id }).del();
  if (!features.length) return;
  await trx('farm_map_feature').insert(
    features.map((f) => ({ ...f, farm_map_id, points: JSON.stringify(f.points) })),
  );
};

/** Rows of each plan, for the hash and the export. Deleted plans are included: a retired map keeps its rows. */
const loadEntries = async (farm_id, farm_map_id) => {
  const plans = await RowPlanModel.query()
    .join('farm_map_row_plan as m', 'm.row_plan_id', 'row_plan.row_plan_id')
    .where({ 'm.farm_map_id': farm_map_id })
    .select('row_plan.*')
    .orderBy('row_plan.field_number');
  const rows = plans.length
    ? await FieldRowModel.query()
        .whereNotDeleted()
        .whereIn(
          'row_plan_id',
          plans.map((plan) => plan.row_plan_id),
        )
        .orderBy('position')
    : [];
  const areas = plans.length
    ? await getFieldAreas(
        farm_id,
        plans.map((plan) => plan.location_id),
      )
    : [];
  const areaByLocation = new Map(areas.map((area) => [area.location_id, area]));
  return plans.map((plan) => ({
    plan,
    field_number: plan.field_number,
    rows: rows.filter((row) => row.row_plan_id === plan.row_plan_id),
    name: areaByLocation.get(plan.location_id)?.name ?? null,
    ring: areaByLocation.get(plan.location_id)?.grid_points ?? null,
  }));
};

const sendFarmMapGeoJSON = async (res, farmMap) => {
  if (farmMap.status === 'draft') {
    throw new RowPlanError('a draft map cannot be exported: publish it first', 409);
  }
  const entries = await loadEntries(farmMap.farm_id, farmMap.farm_map_id);
  const numbered = await Model.knex()('row_plan_field_number')
    .where({ farm_id: farmMap.farm_id })
    .select('location_id', 'field_number');
  const fieldNumbers = Object.fromEntries(
    numbered.map(({ location_id, field_number }) => [location_id, field_number]),
  );
  const nextFieldNumber = Math.max(0, ...Object.values(fieldNumbers)) + 1;
  res.type('application/geo+json');
  // The hash names the content, so a robot can ask whether it already has this map (If-None-Match).
  res.set('ETag', `"${farmMap.content_hash}"`);
  return res
    .status(200)
    .send(
      buildFarmRowPlanGeoJSON(
        entries,
        { fieldNumbers, nextFieldNumber },
        farmMap,
        await getFeatures(farmMap.farm_map_id),
      ),
    );
};

const farmMapController = {
  /**
   * POST /farm_map   body: { farm_id, name, season?, row_plan_ids? }
   * Makes a draft holding the given plans, or the current plan of every field. Its version is the next one for
   * the farm and it follows the farm's newest map.
   */
  createFarmMap() {
    return async (req, res) => {
      const { farm_id } = req.headers;
      const { name, season, row_plan_ids } = req.body;
      const context = { user_id: req.auth?.user_id };
      let trx;
      try {
        if (typeof name !== 'string' || !name.trim() || name.length > 255) {
          throw new RowPlanError('name must be text of up to 255 characters');
        }
        if (season != null && (typeof season !== 'string' || season.length > 100)) {
          throw new RowPlanError('season must be text of up to 100 characters');
        }
        trx = await transaction.start(Model.knex());
        await lockFarmMaps(trx, farm_id);
        const plans = await resolvePlans(trx, farm_id, row_plan_ids);
        const latest = await FarmMapModel.query(trx)
          .whereNotDeleted()
          .where({ farm_id })
          .orderBy('version', 'desc')
          .first();
        const farm_map = await FarmMapModel.query(trx)
          .context(context)
          .insert({
            farm_id,
            name: name.trim(),
            season: season ?? null,
            version: (latest?.version ?? 0) + 1,
            previous_farm_map_id: latest?.farm_map_id ?? null,
          })
          .returning('*');
        await setMembers(trx, farm_map.farm_map_id, plans);
        await trx.commit();
        return res.status(201).send({ farm_map, plans: await getMembers(farm_map.farm_map_id) });
      } catch (error) {
        if (trx) await trx.rollback();
        return sendError(res, error);
      }
    };
  },

  /** GET /farm_map/farm/:farm_id */
  listFarmMaps() {
    return async (req, res) => {
      try {
        const maps = await FarmMapModel.query()
          .whereNotDeleted()
          .select(
            'farm_map.*',
            raw(
              '(select count(*) from farm_map_row_plan m where m.farm_map_id = farm_map.farm_map_id)::int as plan_count',
            ),
          )
          .where({ 'farm_map.farm_id': req.params.farm_id })
          .orderBy('farm_map.version', 'desc');
        return res.status(200).send(maps);
      } catch (error) {
        return sendError(res, error);
      }
    };
  },

  /** GET /farm_map/:farm_map_id */
  getFarmMap() {
    return async (req, res) => {
      try {
        const farm_map = await getFarmMapRecord(req.headers.farm_id, req.params.farm_map_id);
        if (!farm_map) return res.sendStatus(404);
        return res.status(200).send({
          ...farm_map,
          plans: await getMembers(farm_map.farm_map_id),
          features: await getFeatures(farm_map.farm_map_id),
        });
      } catch (error) {
        return sendError(res, error);
      }
    };
  },

  /**
   * PUT /farm_map/:farm_map_id/features   body: { features: [{ kind, name, points, heading_deg?, from_node?, to_node? }] }
   * Replaces the docks and routes of a draft map. A dock is one point named dock, dock1, ...; a route is a line
   * from one node (a dock or a row node such as F1R0N0) to another, with any points between as waypoints.
   */
  setFarmMapFeatures() {
    return async (req, res) => {
      const { farm_id } = req.headers;
      let trx;
      try {
        trx = await transaction.start(Model.knex());
        await lockFarmMaps(trx, farm_id);
        const farm_map = await FarmMapModel.query(trx)
          .whereNotDeleted()
          .where({ farm_id, farm_map_id: req.params.farm_map_id })
          .first();
        if (!farm_map) {
          await trx.rollback();
          return res.sendStatus(404);
        }
        if (farm_map.status !== 'draft') {
          throw new RowPlanError('only a draft map can change its docks and routes', 409);
        }
        const members = await getMembers(farm_map.farm_map_id, trx);
        const rows = members.length
          ? await FieldRowModel.query(trx)
              .whereNotDeleted()
              .whereIn(
                'row_plan_id',
                members.map((m) => m.row_plan_id),
              )
          : [];
        const features = validateFarmMapFeatures(
          req.body.features,
          members.map((m) => ({
            field_number: m.field_number,
            rows: rows.filter((row) => row.row_plan_id === m.row_plan_id),
          })),
        );
        await setFeatures(trx, farm_map.farm_map_id, features);
        await trx.commit();
        return res
          .status(200)
          .send({ ...farm_map, features: await getFeatures(farm_map.farm_map_id) });
      } catch (error) {
        if (trx) await trx.rollback();
        return sendError(res, error);
      }
    };
  },

  /** PUT /farm_map/:farm_map_id/plans   body: { row_plan_ids }   Draft maps only. */
  setFarmMapPlans() {
    return async (req, res) => {
      const { farm_id } = req.headers;
      let trx;
      try {
        trx = await transaction.start(Model.knex());
        await lockFarmMaps(trx, farm_id);
        const farm_map = await FarmMapModel.query(trx)
          .whereNotDeleted()
          .where({ farm_id, farm_map_id: req.params.farm_map_id })
          .first();
        if (!farm_map) {
          await trx.rollback();
          return res.sendStatus(404);
        }
        if (farm_map.status !== 'draft') {
          throw new RowPlanError('only a draft map can change its plans', 409);
        }
        if (req.body.row_plan_ids == null) throw new RowPlanError('row_plan_ids is required');
        const plans = await resolvePlans(trx, farm_id, req.body.row_plan_ids);
        await setMembers(trx, farm_map.farm_map_id, plans);
        await trx.commit();
        return res.status(200).send({ ...farm_map, plans: await getMembers(farm_map.farm_map_id) });
      } catch (error) {
        if (trx) await trx.rollback();
        return sendError(res, error);
      }
    };
  },

  /**
   * POST /farm_map/:farm_map_id/publish
   * Freezes a draft: records its content_hash and publish time, and retires the farm's previously published map.
   * Refused if any of its plans has been replaced or deleted since it was put in the draft.
   */
  publishFarmMap() {
    return async (req, res) => {
      const { farm_id } = req.headers;
      const context = { user_id: req.auth?.user_id };
      let trx;
      try {
        trx = await transaction.start(Model.knex());
        await lockFarmMaps(trx, farm_id);
        const farm_map = await FarmMapModel.query(trx)
          .whereNotDeleted()
          .where({ farm_id, farm_map_id: req.params.farm_map_id })
          .first();
        if (!farm_map) {
          await trx.rollback();
          return res.sendStatus(404);
        }
        if (farm_map.status !== 'draft') {
          throw new RowPlanError(`this map is already ${farm_map.status}`, 409);
        }
        const members = await getMembers(farm_map.farm_map_id, trx);
        if (!members.length) throw new RowPlanError('a farm map needs at least one row plan');
        const live = await RowPlanModel.query(trx)
          .whereNotDeleted()
          .whereNull('superseded_at')
          .whereIn(
            'row_plan_id',
            members.map((m) => m.row_plan_id),
          )
          .forShare();
        const liveIds = new Set(live.map((plan) => plan.row_plan_id));
        const stale = members.filter((m) => !liveIds.has(m.row_plan_id));
        if (stale.length) {
          throw new RowPlanError(
            `plans have been replaced or deleted since this draft was made: ${stale
              .map((m) => `field ${m.field_number}`)
              .join(', ')}`,
            409,
          );
        }
        const rows = await FieldRowModel.query(trx)
          .whereNotDeleted()
          .whereIn(
            'row_plan_id',
            members.map((m) => m.row_plan_id),
          )
          .orderBy('position');
        const entries = members.map((m) => ({
          field_number: m.field_number,
          rows: rows.filter((row) => row.row_plan_id === m.row_plan_id),
        }));
        // The plans may have been swapped since the routes were drawn: every route must still meet its nodes.
        const features = await getFeatures(farm_map.farm_map_id, trx);
        checkRouteEnds(features, entries);
        const content_hash = computeFarmMapHash(entries, features);
        const now = new Date().toISOString();
        await FarmMapModel.query(trx)
          .context(context)
          .patch({ status: 'retired', retired_at: now })
          .where({ farm_id, status: 'published' })
          .whereNot({ farm_map_id: farm_map.farm_map_id });
        const published = await FarmMapModel.query(trx)
          .context(context)
          .patchAndFetchById(farm_map.farm_map_id, {
            status: 'published',
            content_hash,
            published_at: now,
          });
        await trx.commit();
        return res.status(200).send({ ...published, plans: members });
      } catch (error) {
        if (trx) await trx.rollback();
        return sendError(res, error);
      }
    };
  },

  /** POST /farm_map/:farm_map_id/retire   Published maps only. Its plans can then be replaced again. */
  retireFarmMap() {
    return async (req, res) => {
      const { farm_id } = req.headers;
      const context = { user_id: req.auth?.user_id };
      let trx;
      try {
        trx = await transaction.start(Model.knex());
        await lockFarmMaps(trx, farm_id);
        const farm_map = await FarmMapModel.query(trx)
          .whereNotDeleted()
          .where({ farm_id, farm_map_id: req.params.farm_map_id })
          .first();
        if (!farm_map) {
          await trx.rollback();
          return res.sendStatus(404);
        }
        if (farm_map.status !== 'published') {
          throw new RowPlanError('only a published map can be retired', 409);
        }
        const retired = await FarmMapModel.query(trx)
          .context(context)
          .patchAndFetchById(farm_map.farm_map_id, {
            status: 'retired',
            retired_at: new Date().toISOString(),
          });
        await trx.commit();
        return res.status(200).send(retired);
      } catch (error) {
        if (trx) await trx.rollback();
        return sendError(res, error);
      }
    };
  },

  /** DELETE /farm_map/:farm_map_id   Draft maps only. Published maps are retired, not deleted. */
  deleteFarmMap() {
    return async (req, res) => {
      const context = { user_id: req.auth?.user_id };
      try {
        const farm_map = await getFarmMapRecord(req.headers.farm_id, req.params.farm_map_id);
        if (!farm_map) return res.sendStatus(404);
        if (farm_map.status !== 'draft') {
          throw new RowPlanError('only a draft map can be deleted', 409);
        }
        const updated = await FarmMapModel.query()
          .context(context)
          .patch({ deleted: true })
          .where({ farm_map_id: farm_map.farm_map_id, status: 'draft' });
        if (!updated) {
          throw new RowPlanError('only a draft map can be deleted', 409);
        }
        return res.sendStatus(204);
      } catch (error) {
        return sendError(res, error);
      }
    };
  },

  /** GET /farm_map/:farm_map_id/geojson   The map as a multi-field GeoJSON file, with its id, version and hash. */
  exportFarmMap() {
    return async (req, res) => {
      try {
        const farm_map = await getFarmMapRecord(req.headers.farm_id, req.params.farm_map_id);
        if (!farm_map) return res.sendStatus(404);
        return await sendFarmMapGeoJSON(res, farm_map);
      } catch (error) {
        return sendError(res, error);
      }
    };
  },

  /** GET /farm_map/farm/:farm_id/published/geojson   The farm's published map: what a robot should be running. */
  exportPublishedFarmMap() {
    return async (req, res) => {
      try {
        const farm_map = await FarmMapModel.query()
          .whereNotDeleted()
          .where({ farm_id: req.params.farm_id, status: 'published' })
          .first();
        if (!farm_map) return res.status(404).json({ error: 'this farm has no published map' });
        return await sendFarmMapGeoJSON(res, farm_map);
      } catch (error) {
        return sendError(res, error);
      }
    };
  },
};

export default farmMapController;
