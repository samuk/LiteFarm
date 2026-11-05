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

import PropTypes from 'prop-types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './styles.module.scss';

export default function RowPlannerControl({
  fields,
  fieldId,
  settings,
  surveyCount,
  isBusy,
  statusKey,
  summary,
  errorKey,
  errorMessage,
  hasPlan,
  isSaving,
  isSaved,
  saveError,
  saveWarnings,
  onFieldChange,
  onSettingsChange,
  onSurveyFile,
  onPlan,
  onClear,
  onDownload,
  onSave,
  onDownloadAll,
  hasSavedPlans,
  fieldNumber,
  farmMap,
  fieldLocked,
  isMapBusy,
  mapErrorMessage,
  onPublishMap,
  onRetireMap,
  onDownloadMap,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [mapName, setMapName] = useState('');
  const [mapSeason, setMapSeason] = useState('');
  const [confirmRetire, setConfirmRetire] = useState(false);
  const prefix = 'FARM_MAP.ROW_PLANNER.';
  const set = (key, value) => onSettingsChange({ ...settings, [key]: value });

  const numberInput = (key, labelKey, props) => (
    <label className={styles.field}>
      {t(prefix + labelKey)}
      <input
        type="number"
        value={settings[key]}
        disabled={isBusy}
        onChange={(event) => set(key, event.target.value)}
        {...props}
      />
    </label>
  );

  return (
    <div className={styles.control} data-cy="row-planner-control">
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls="row-planner-panel"
        onClick={() => setOpen(!open)}
      >
        {t(prefix + 'TITLE')}
      </button>
      {open && (
        <div id="row-planner-panel" className={styles.panel}>
          {!fields.length ? (
            <p>{t(prefix + 'NO_FIELDS')}</p>
          ) : (
            <>
              <label className={styles.field}>
                {t(prefix + 'FIELD')}
                <select
                  value={fieldId ?? ''}
                  disabled={isBusy}
                  onChange={(event) => onFieldChange(event.target.value)}
                >
                  {fields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}
                    </option>
                  ))}
                </select>
              </label>
              {fieldNumber !== undefined && (
                <p className={styles.note}>{t(prefix + 'FIELD_NAMING', { field: fieldNumber })}</p>
              )}
              {fieldLocked && (
                <p className={styles.note} role="status">
                  {t(prefix + 'FIELD_LOCKED', { name: farmMap?.name, version: farmMap?.version })}
                </p>
              )}
              {numberInput('toolWidth', 'TOOL_WIDTH', { min: 0.5, step: 0.5 })}
              {!settings.contour && numberInput('angle', 'ANGLE', { step: 5 })}
              {numberInput('headland', 'HEADLAND', { min: 0, step: 1 })}
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={settings.snake}
                  disabled={isBusy}
                  onChange={(event) => set('snake', event.target.checked)}
                />
                {t(prefix + 'SNAKE')}
              </label>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={settings.contour}
                  disabled={isBusy}
                  onChange={(event) => set('contour', event.target.checked)}
                />
                {t(prefix + 'CONTOUR')}
              </label>
              {settings.contour && (
                <>
                  <label className={styles.field}>
                    {t(prefix + 'SURVEY')}
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      disabled={isBusy}
                      onChange={(event) => onSurveyFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  {surveyCount > 0 && (
                    <p className={styles.result}>
                      {t(prefix + 'SURVEY_LOADED', { count: surveyCount })}
                    </p>
                  )}
                  {numberInput('gridResolution', 'GRID', { min: 0.25, step: 0.25 })}
                </>
              )}
              <div className={styles.actions}>
                <button type="button" className={styles.button} disabled={isBusy} onClick={onPlan}>
                  {isBusy ? t(prefix + 'PLANNING') : t(prefix + 'PLAN')}
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={isBusy || !hasPlan}
                  onClick={onClear}
                >
                  {t(prefix + 'CLEAR')}
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={isBusy || !hasPlan}
                  onClick={onDownload}
                >
                  {t(prefix + 'DOWNLOAD')}
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={isBusy || !hasSavedPlans}
                  onClick={onDownloadAll}
                >
                  {t(prefix + 'DOWNLOAD_ALL')}
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={isBusy || isSaving || isSaved || !hasPlan || fieldLocked}
                  onClick={onSave}
                >
                  {isSaving
                    ? t(prefix + 'SAVING')
                    : isSaved
                      ? t(prefix + 'SAVED')
                      : t(prefix + 'SAVE')}
                </button>
              </div>
              {isBusy && statusKey && (
                <p className={styles.result} role="status">
                  {t(prefix + 'STATUS.' + statusKey)}
                </p>
              )}
              {errorKey && (
                <p className={styles.error} role="alert">
                  {t(prefix + 'ERRORS.' + errorKey)}
                </p>
              )}
              {errorMessage && (
                <p className={styles.error} role="alert">
                  {t(prefix + 'FAILED', { message: errorMessage })}
                </p>
              )}
              {saveError && (
                <p className={styles.error} role="alert">
                  {t(prefix + 'SAVE_FAILED', { message: saveError })}
                </p>
              )}
              {isSaved && saveWarnings?.length > 0 && (
                <p className={styles.result} role="status">
                  {t(prefix + 'SAVE_WARNINGS', { message: saveWarnings.join('; ') })}
                </p>
              )}
              {summary && !isBusy && (
                <p className={styles.result}>
                  {!summary.rows
                    ? t(prefix + 'NO_ROWS')
                    : [
                        summary.fellBack && t(prefix + 'FELL_BACK'),
                        summary.contourUsed && t(prefix + 'CONTOUR_USED'),
                        t(prefix + 'RESULT', {
                          rows: summary.rows,
                          swath: summary.swathKm.toFixed(2),
                        }),
                        summary.passes > 0 &&
                          t(prefix + 'PATH', {
                            path: summary.pathKm.toFixed(2),
                            passes: summary.passes,
                          }),
                      ]
                        .filter(Boolean)
                        .join('\n')}
                </p>
              )}
              <p className={styles.note}>{t(prefix + 'NOTE')}</p>
              <div className={styles.section} data-cy="farm-map-section">
                <h3 className={styles.heading}>{t(prefix + 'FARM_MAP.TITLE')}</h3>
                <p className={styles.result}>
                  {farmMap
                    ? t(prefix + 'FARM_MAP.PUBLISHED', {
                        name: farmMap.name,
                        version: farmMap.version,
                        season: farmMap.season ?? '',
                        count: farmMap.plans?.length ?? 0,
                      })
                    : t(prefix + 'FARM_MAP.NONE')}
                </p>
                <label className={styles.field}>
                  {t(prefix + 'FARM_MAP.NAME')}
                  <input
                    type="text"
                    value={mapName}
                    maxLength={255}
                    disabled={isMapBusy}
                    onChange={(event) => setMapName(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  {t(prefix + 'FARM_MAP.SEASON')}
                  <input
                    type="text"
                    value={mapSeason}
                    maxLength={100}
                    disabled={isMapBusy}
                    onChange={(event) => setMapSeason(event.target.value)}
                  />
                </label>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={isBusy || isMapBusy || !hasSavedPlans || !mapName.trim()}
                    onClick={() => onPublishMap({ name: mapName.trim(), season: mapSeason.trim() })}
                  >
                    {isMapBusy ? t(prefix + 'FARM_MAP.PUBLISHING') : t(prefix + 'FARM_MAP.PUBLISH')}
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={isMapBusy || !farmMap}
                    onClick={onDownloadMap}
                  >
                    {t(prefix + 'FARM_MAP.DOWNLOAD')}
                  </button>
                  {farmMap && !confirmRetire && (
                    <button
                      type="button"
                      className={styles.button}
                      disabled={isMapBusy}
                      onClick={() => setConfirmRetire(true)}
                    >
                      {t(prefix + 'FARM_MAP.RETIRE')}
                    </button>
                  )}
                  {farmMap && confirmRetire && (
                    <>
                      <button
                        type="button"
                        className={styles.button}
                        disabled={isMapBusy}
                        onClick={() => {
                          setConfirmRetire(false);
                          onRetireMap();
                        }}
                      >
                        {t(prefix + 'FARM_MAP.CONFIRM_RETIRE')}
                      </button>
                      <button
                        type="button"
                        className={styles.button}
                        onClick={() => setConfirmRetire(false)}
                      >
                        {t(prefix + 'FARM_MAP.CANCEL')}
                      </button>
                    </>
                  )}
                </div>
                {mapErrorMessage && (
                  <p className={styles.error} role="alert">
                    {t(prefix + 'FARM_MAP.FAILED', { message: mapErrorMessage })}
                  </p>
                )}
                <p className={styles.note}>{t(prefix + 'FARM_MAP.NOTE')}</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

RowPlannerControl.propTypes = {
  fields: PropTypes.arrayOf(
    PropTypes.shape({ id: PropTypes.string.isRequired, name: PropTypes.string }),
  ).isRequired,
  fieldId: PropTypes.string,
  settings: PropTypes.object.isRequired,
  surveyCount: PropTypes.number,
  isBusy: PropTypes.bool,
  statusKey: PropTypes.string,
  summary: PropTypes.object,
  errorKey: PropTypes.string,
  errorMessage: PropTypes.string,
  hasPlan: PropTypes.bool,
  isSaving: PropTypes.bool,
  isSaved: PropTypes.bool,
  saveError: PropTypes.string,
  saveWarnings: PropTypes.arrayOf(PropTypes.string),
  onFieldChange: PropTypes.func.isRequired,
  onSettingsChange: PropTypes.func.isRequired,
  onSurveyFile: PropTypes.func.isRequired,
  onPlan: PropTypes.func.isRequired,
  onClear: PropTypes.func.isRequired,
  onDownload: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onDownloadAll: PropTypes.func,
  hasSavedPlans: PropTypes.bool,
  fieldNumber: PropTypes.number,
  farmMap: PropTypes.shape({
    name: PropTypes.string,
    version: PropTypes.number,
    season: PropTypes.string,
    plans: PropTypes.array,
  }),
  fieldLocked: PropTypes.bool,
  isMapBusy: PropTypes.bool,
  mapErrorMessage: PropTypes.string,
  onPublishMap: PropTypes.func,
  onRetireMap: PropTypes.func,
  onDownloadMap: PropTypes.func,
};
