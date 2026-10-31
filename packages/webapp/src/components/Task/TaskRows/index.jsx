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
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../../Form/Button';
import { CheckboxMultiSelect } from '../../Form/ReactSelect/CheckboxMultiSelect';
import { Error, Label, Semibold, Text } from '../../Typography';
import { countRowStatuses, formatRowSpec, hasRowResults } from '../../../util/taskRows';
import styles from './styles.module.scss';

const MAX_LISTED_MISSING = 5;

export default function PureTaskRows({
  rows,
  planRowNumbers,
  canEdit,
  isSaving,
  saveError,
  onSave,
}) {
  const { t } = useTranslation();
  const prefix = 'TASK.ROWS.';
  const current = [...new Set(rows.map((row) => row.row_number))].sort((a, b) => a - b);
  const currentSpec = formatRowSpec(current);
  const [selected, setSelected] = useState(current);
  const [error, setError] = useState('');

  // Show what the task has once it loads or the saved rows change.
  useEffect(() => {
    setSelected(current);
    setError('');
    // `current` is rebuilt every render, so key the reset on its text form.
  }, [currentSpec]);

  // Every row in the plan, plus any saved row the plan no longer has, so it stays visible.
  const options = useMemo(
    () =>
      [...new Set([...planRowNumbers, ...current])]
        .sort((a, b) => a - b)
        .map((n) => ({ value: n, label: String(n) })),
    [planRowNumbers, currentSpec],
  );

  const locked = hasRowResults(rows);
  const counts = countRowStatuses(rows);
  const selectedSpec = formatRowSpec(selected);

  const handleChange = (values) => {
    setSelected(values.map((option) => option.value));
    setError('');
  };

  const handleSave = () => {
    if (!selected.length) {
      setError(t(`${prefix}ERRORS.EMPTY`));
      return;
    }
    const inPlan = new Set(planRowNumbers);
    const missing = selected.filter((n) => !inPlan.has(n));
    if (missing.length) {
      const listed = formatRowSpec(missing.slice(0, MAX_LISTED_MISSING));
      setError(t(`${prefix}ERRORS.NOT_IN_PLAN`, { rows: listed }));
      return;
    }
    setError('');
    onSave([...selected].sort((a, b) => a - b));
  };

  return (
    <div className={styles.rows} data-testid="task-rows">
      <Semibold className={styles.title}>{t(`${prefix}TITLE`)}</Semibold>
      <Text>
        {current.length
          ? t(`${prefix}SUMMARY`, { rows: currentSpec, count: current.length })
          : t(`${prefix}NONE`)}
      </Text>
      {locked && (
        <Text className={styles.counts}>
          {[
            t(`${prefix}DONE`, { count: counts.done }),
            t(`${prefix}ABORTED`, { count: counts.aborted }),
            t(`${prefix}PENDING`, { count: counts.pending }),
          ].join(', ')}
        </Text>
      )}
      {canEdit && locked && <Text className={styles.note}>{t(`${prefix}LOCKED`)}</Text>}
      {canEdit && !locked && (
        <div className={styles.editor}>
          <div className={styles.select}>
            <Label>{t(`${prefix}INPUT_LABEL`)}</Label>
            <CheckboxMultiSelect
              options={options}
              value={options.filter((option) => selected.includes(option.value))}
              onChange={handleChange}
              placeholder={t(`${prefix}EMPTY`)}
              isDisabled={isSaving}
            />
            {(error || saveError) && (
              <Error role="alert">{error || t(`${prefix}ERRORS.SAVE_FAILED`)}</Error>
            )}
          </div>
          <Button
            color="secondary"
            sm
            disabled={isSaving || selectedSpec === currentSpec}
            onClick={handleSave}
          >
            {t(`${prefix}SAVE`)}
          </Button>
        </div>
      )}
    </div>
  );
}

PureTaskRows.propTypes = {
  rows: PropTypes.arrayOf(
    PropTypes.shape({
      row_number: PropTypes.number.isRequired,
      status: PropTypes.oneOf(['pending', 'done', 'aborted']).isRequired,
    }),
  ).isRequired,
  planRowNumbers: PropTypes.arrayOf(PropTypes.number).isRequired,
  canEdit: PropTypes.bool,
  isSaving: PropTypes.bool,
  saveError: PropTypes.bool,
  onSave: PropTypes.func.isRequired,
};
