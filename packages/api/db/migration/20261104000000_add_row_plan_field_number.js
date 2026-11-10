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
 * Field numbers for row plans. Each field with rows gets a number (1, 2, ...) that is unique within the farm and
 * stays with the field, so rows and nodes can be named F<field>R<row>N<node>, for example F1R12N3.
 * Every plan of the same field carries the same number, including superseded and retracted ones.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await knex.schema.alterTable('row_plan', (t) => {
    t.integer('field_number');
  });
  // Number existing fields in the order their first plan was made.
  await knex.raw(`
    UPDATE row_plan
    SET field_number = ranked.field_number
    FROM (
      SELECT farm_id, location_id,
             DENSE_RANK() OVER (PARTITION BY farm_id ORDER BY first_created, location_id) AS field_number
      FROM (
        SELECT farm_id, location_id, MIN(created_at) OVER (PARTITION BY farm_id, location_id) AS first_created
        FROM row_plan
      ) firsts
      GROUP BY farm_id, location_id, first_created
    ) ranked
    WHERE row_plan.farm_id = ranked.farm_id AND row_plan.location_id = ranked.location_id
  `);
  await knex.raw('ALTER TABLE row_plan ALTER COLUMN field_number SET NOT NULL');
  await knex.raw(
    'ALTER TABLE row_plan ADD CONSTRAINT row_plan_field_number_positive CHECK (field_number >= 1)',
  );
  await knex.schema.alterTable('row_plan', (t) => {
    t.index(['farm_id', 'field_number']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function (knex) {
  await knex.schema.alterTable('row_plan', (t) => {
    t.dropIndex(['farm_id', 'field_number']);
  });
  await knex.raw('ALTER TABLE row_plan DROP CONSTRAINT row_plan_field_number_positive');
  await knex.schema.alterTable('row_plan', (t) => {
    t.dropColumn('field_number');
  });
};
