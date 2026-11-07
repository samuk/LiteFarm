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
 * Docks and routes of a farm map: where a robot charges, and the lines it drives between a dock and a field.
 * They belong to the map, freeze with it, and are covered by its content_hash when it has any.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await knex.schema.createTable('farm_map_feature', (t) => {
    t.uuid('farm_map_feature_id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('farm_map_id')
      .notNullable()
      .references('farm_map_id')
      .inTable('farm_map')
      .onDelete('CASCADE');
    t.enu('kind', ['dock', 'route']).notNullable();
    t.string('name', 32).notNullable();
    // [{ lat, lng }, ...]: one point for a dock, two or more for a route (the middle ones are waypoints).
    t.jsonb('points').notNullable();
    // Docks only: the way the robot faces when docked, degrees clockwise from north.
    t.integer('heading_deg');
    // Routes only: the nodes it joins, a dock name or a row node name such as F1R0N0.
    t.string('from_node', 64);
    t.string('to_node', 64);
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['farm_map_id', 'name']);
  });
  await knex.raw(`
    ALTER TABLE farm_map_feature
      ADD CONSTRAINT farm_map_feature_heading CHECK (heading_deg IS NULL OR (heading_deg >= 0 AND heading_deg < 360)),
      ADD CONSTRAINT farm_map_feature_kind_fields CHECK (
        (kind = 'route' AND heading_deg IS NULL AND from_node IS NOT NULL AND to_node IS NOT NULL)
        OR (kind = 'dock' AND from_node IS NULL AND to_node IS NULL)
      )
  `);
  // The same rule as for a map's plans: once a map is published it cannot change.
  await knex.raw(`
    CREATE TRIGGER farm_map_feature_frozen
      BEFORE INSERT OR UPDATE OR DELETE ON farm_map_feature
      FOR EACH ROW EXECUTE FUNCTION farm_map_members_frozen()
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.raw('DROP TRIGGER farm_map_feature_frozen ON farm_map_feature');
  await knex.schema.dropTable('farm_map_feature');
};
