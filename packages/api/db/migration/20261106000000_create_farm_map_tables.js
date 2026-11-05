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

const baseColumns = (knex, t) => {
  t.string('created_by_user_id').references('user_id').inTable('users');
  t.string('updated_by_user_id').references('user_id').inTable('users');
  t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
  t.dateTime('updated_at').notNullable().defaultTo(knex.fn.now());
  t.boolean('deleted').notNullable().defaultTo(false);
};

/**
 * Farm maps: the definitive set of row plans a farm hands to its robots, one per season or longer.
 * A map is a draft until it is published. A published map never changes: its content_hash covers its rows, its
 * plans cannot be superseded or deleted, and a change is a new version. A farm has at most one published map.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await knex.schema.createTable('farm_map', (t) => {
    t.uuid('farm_map_id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('farm_id').notNullable().references('farm_id').inTable('farm');
    t.string('name', 255).notNullable();
    t.string('season', 100);
    t.integer('version').notNullable();
    t.uuid('previous_farm_map_id').references('farm_map_id').inTable('farm_map');
    t.enu('status', ['draft', 'published', 'retired']).notNullable().defaultTo('draft');
    t.string('content_hash', 64);
    t.dateTime('published_at');
    t.dateTime('retired_at');
    baseColumns(knex, t);
    t.unique(['farm_id', 'version'], {
      indexName: 'farm_map_farm_version_live_unique',
      predicate: knex.whereRaw('deleted = false'),
    });
    t.unique(['farm_id'], {
      indexName: 'farm_map_one_published_per_farm',
      predicate: knex.whereRaw("deleted = false AND status = 'published'"),
    });
  });
  await knex.raw(`
    ALTER TABLE farm_map
      ADD CONSTRAINT farm_map_version_positive CHECK (version >= 1),
      ADD CONSTRAINT farm_map_published_fields CHECK (
        status = 'draft' OR (content_hash IS NOT NULL AND published_at IS NOT NULL)
      ),
      ADD CONSTRAINT farm_map_retired_fields CHECK (status <> 'retired' OR retired_at IS NOT NULL)
  `);

  await knex.schema.createTable('farm_map_row_plan', (t) => {
    t.uuid('farm_map_id')
      .notNullable()
      .references('farm_map_id')
      .inTable('farm_map')
      .onDelete('CASCADE');
    t.uuid('row_plan_id').notNullable().references('row_plan_id').inTable('row_plan');
    t.uuid('location_id').notNullable().references('location_id').inTable('location');
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['farm_map_id', 'row_plan_id']);
    // One plan per field in a map.
    t.unique(['farm_map_id', 'location_id']);
    t.index(['row_plan_id']);
  });

  // The database refuses to change a map once it is published, whatever writes to it.
  await knex.raw(`
    CREATE FUNCTION farm_map_members_frozen() RETURNS trigger AS $$
    DECLARE
      map_status text;
    BEGIN
      SELECT status INTO map_status FROM farm_map
        WHERE farm_map_id = COALESCE(NEW.farm_map_id, OLD.farm_map_id);
      IF map_status IS NOT NULL AND map_status <> 'draft' THEN
        RAISE EXCEPTION 'farm map % is % and its plans cannot change',
          COALESCE(NEW.farm_map_id, OLD.farm_map_id), map_status;
      END IF;
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(`
    CREATE TRIGGER farm_map_row_plan_frozen
      BEFORE INSERT OR UPDATE OR DELETE ON farm_map_row_plan
      FOR EACH ROW EXECUTE FUNCTION farm_map_members_frozen()
  `);
  await knex.raw(`
    CREATE FUNCTION row_plan_in_published_map() RETURNS trigger AS $$
    BEGIN
      IF ((NEW.deleted AND NOT OLD.deleted) OR (NEW.superseded_at IS NOT NULL AND OLD.superseded_at IS NULL))
         AND EXISTS (
           SELECT 1 FROM farm_map_row_plan m JOIN farm_map f USING (farm_map_id)
           WHERE m.row_plan_id = OLD.row_plan_id AND f.status = 'published' AND f.deleted = false
         ) THEN
        RAISE EXCEPTION 'row plan % is in a published farm map', OLD.row_plan_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(`
    CREATE TRIGGER row_plan_published_lock
      BEFORE UPDATE ON row_plan
      FOR EACH ROW EXECUTE FUNCTION row_plan_in_published_map()
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.raw('DROP TRIGGER row_plan_published_lock ON row_plan');
  await knex.raw('DROP FUNCTION row_plan_in_published_map()');
  await knex.raw('DROP TRIGGER farm_map_row_plan_frozen ON farm_map_row_plan');
  await knex.raw('DROP FUNCTION farm_map_members_frozen()');
  await knex.schema.dropTable('farm_map_row_plan');
  await knex.schema.dropTable('farm_map');
};
