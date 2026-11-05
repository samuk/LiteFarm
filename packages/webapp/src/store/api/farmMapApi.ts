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

import { api } from './apiSlice';
import { farmMapUrl } from '../../apiConfig';

export type FarmMapStatus = 'draft' | 'published' | 'retired';

export interface FarmMap {
  farm_map_id: string;
  farm_id: string;
  name: string;
  season: string | null;
  version: number;
  status: FarmMapStatus;
  content_hash: string | null;
  previous_farm_map_id: string | null;
  published_at: string | null;
  retired_at: string | null;
}

export interface FarmMapPlan {
  row_plan_id: string;
  location_id: string;
  field_number: number;
  source: 'in_app' | 'robot';
  map_id: string | null;
  row_count: number;
}

export type FarmMapWithPlans = FarmMap & { plans: FarmMapPlan[] };

export interface PublishFarmMapArgs {
  farm_id: string;
  name: string;
  season?: string;
}

// A farm has at most one published map. A plan in it is frozen: the api refuses to supersede or delete it
// until the map is retired, so the app needs to know which fields are frozen.
export const farmMapApi = api.injectEndpoints({
  endpoints: (build) => ({
    getPublishedFarmMap: build.query<FarmMapWithPlans | null, { farm_id: string }>({
      async queryFn({ farm_id }, _api, _extraOptions, baseQuery) {
        const list = await baseQuery(`${farmMapUrl}/farm/${farm_id}`);
        if (list.error) return { error: list.error };
        const published = (list.data as FarmMap[]).find((map) => map.status === 'published');
        if (!published) return { data: null };
        const one = await baseQuery(`${farmMapUrl}/${published.farm_map_id}`);
        if (one.error) return { error: one.error };
        return { data: one.data as FarmMapWithPlans };
      },
      providesTags: ['FarmMaps'],
    }),
    // Puts the current plan of every field in a new map version and publishes it, which retires the
    // previous published map. A draft left behind by a failed publish is deleted again.
    publishFarmMap: build.mutation<FarmMapWithPlans, PublishFarmMapArgs>({
      async queryFn({ name, season }, _api, _extraOptions, baseQuery) {
        const created = await baseQuery({
          url: farmMapUrl,
          method: 'POST',
          body: { name, season: season || undefined },
        });
        if (created.error) return { error: created.error };
        const { farm_map } = created.data as { farm_map: FarmMap };
        const published = await baseQuery({
          url: `${farmMapUrl}/${farm_map.farm_map_id}/publish`,
          method: 'POST',
        });
        if (published.error) {
          await baseQuery({ url: `${farmMapUrl}/${farm_map.farm_map_id}`, method: 'DELETE' });
          return { error: published.error };
        }
        return { data: published.data as FarmMapWithPlans };
      },
      invalidatesTags: ['FarmMaps'],
    }),
    // Unfreezes the plans so fields can be re-planned. The farm has no published map until a new one is published.
    retireFarmMap: build.mutation<FarmMap, { farm_map_id: string }>({
      query: ({ farm_map_id }) => ({ url: `${farmMapUrl}/${farm_map_id}/retire`, method: 'POST' }),
      invalidatesTags: ['FarmMaps'],
    }),
    // The published map as the file robots import. Not cached: the download must be the current map.
    getPublishedFarmMapGeoJSON: build.query<object, { farm_id: string }>({
      query: ({ farm_id }) => ({
        url: `${farmMapUrl}/farm/${farm_id}/published/geojson`,
        responseHandler: 'json',
      }),
      keepUnusedDataFor: 0,
    }),
  }),
});

export const {
  useGetPublishedFarmMapQuery,
  usePublishFarmMapMutation,
  useRetireFarmMapMutation,
  useLazyGetPublishedFarmMapGeoJSONQuery,
} = farmMapApi;
