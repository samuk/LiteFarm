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

import BaseModel from './baseModel.js';

class FarmMapModel extends BaseModel {
  static get tableName() {
    return 'farm_map';
  }

  static get idColumn() {
    return 'farm_map_id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['farm_id', 'name', 'version'],
      properties: {
        farm_map_id: { type: 'string' },
        farm_id: { type: 'string' },
        name: { type: 'string', minLength: 1, maxLength: 255 },
        season: { type: ['string', 'null'], maxLength: 100 },
        version: { type: 'integer', minimum: 1 },
        previous_farm_map_id: { type: ['string', 'null'] },
        status: { type: 'string', enum: ['draft', 'published', 'retired'] },
        content_hash: { type: ['string', 'null'], maxLength: 64 },
        published_at: { type: ['string', 'null'] },
        retired_at: { type: ['string', 'null'] },
        ...this.baseProperties,
      },
      additionalProperties: false,
    };
  }
}

export default FarmMapModel;
