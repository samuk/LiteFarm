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

import express from 'express';
import farmMapController from '../controllers/farmMapController.js';
import checkScope from '../middleware/acl/checkScope.js';
import hasFarmAccess from '../middleware/acl/hasFarmAccess.js';

const router = express.Router();

// Row plan scopes cover farm maps: anyone who can see plans can see maps, and the people who can import plans
// (owners, managers and extension officers) can build and publish them.
router.post(
  '/',
  hasFarmAccess({ body: 'farm_id' }),
  checkScope(['edit:row_plan']),
  farmMapController.createFarmMap(),
);

// The farm routes come before /:farm_map_id so the routes cannot be confused.
router.get(
  '/farm/:farm_id/published/geojson',
  hasFarmAccess({ params: 'farm_id' }),
  checkScope(['get:row_plan']),
  farmMapController.exportPublishedFarmMap(),
);

router.get(
  '/farm/:farm_id',
  hasFarmAccess({ params: 'farm_id' }),
  checkScope(['get:row_plan']),
  farmMapController.listFarmMaps(),
);

router.get(
  '/:farm_map_id/geojson',
  hasFarmAccess({ params: 'farm_map_id' }),
  checkScope(['get:row_plan']),
  farmMapController.exportFarmMap(),
);

router.get(
  '/:farm_map_id',
  hasFarmAccess({ params: 'farm_map_id' }),
  checkScope(['get:row_plan']),
  farmMapController.getFarmMap(),
);

router.put(
  '/:farm_map_id/plans',
  hasFarmAccess({ params: 'farm_map_id' }),
  checkScope(['edit:row_plan']),
  farmMapController.setFarmMapPlans(),
);

router.post(
  '/:farm_map_id/publish',
  hasFarmAccess({ params: 'farm_map_id' }),
  checkScope(['edit:row_plan']),
  farmMapController.publishFarmMap(),
);

router.post(
  '/:farm_map_id/retire',
  hasFarmAccess({ params: 'farm_map_id' }),
  checkScope(['edit:row_plan']),
  farmMapController.retireFarmMap(),
);

router.delete(
  '/:farm_map_id',
  hasFarmAccess({ params: 'farm_map_id' }),
  checkScope(['edit:row_plan']),
  farmMapController.deleteFarmMap(),
);

export default router;
