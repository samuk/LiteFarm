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
 * A field keeps one number for good, and no two fields on a farm share one. Until now only the controller's
 * lock kept this true. The table makes the database refuse a second number for a field, or a number used twice,
 * and row_plan.field_number must match it.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await knex.schema.createTable('row_plan_field_number', (t) => {
    t.uuid('farm_id').notNullable().references('farm_id').inTable('farm');
    t.uuid('location_id').notNullable().references('location_id').inTable('location');
    t.integer('field_number').notNullable();
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['farm_id', 'location_id']);
    t.unique(['farm_id', 'field_number']);
    // The target of the foreign key from row_plan, so a plan cannot carry another field's number.
    t.unique(['farm_id', 'location_id', 'field_number']);
  });
  await knex.raw(
    'ALTER TABLE row_plan_field_number ADD CONSTRAINT row_plan_field_number_positive CHECK (field_number >= 1)',
  );
  await knex.raw(`
    INSERT INTO row_plan_field_number (farm_id, location_id, field_number)
    SELECT DISTINCT farm_id, location_id, field_number FROM row_plan
  `);
  await knex.raw(`
    ALTER TABLE row_plan
      ADD CONSTRAINT row_plan_field_number_fkey
      FOREIGN KEY (farm_id, location_id, field_number)
      REFERENCES row_plan_field_number (farm_id, location_id, field_number)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.raw('ALTER TABLE row_plan DROP CONSTRAINT row_plan_field_number_fkey');
  await knex.schema.dropTable('row_plan_field_number');
};
