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

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Partial mock: the shared Input imports the app's i18n setup, which needs the real plugin export.
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

import PureTaskRows from '../components/Task/TaskRows';

const row = (row_number: number, status = 'pending') => ({ row_number, status });
const planRowNumbers = Array.from({ length: 30 }, (_, i) => i + 1);

const setup = (props = {}) => {
  const onSave = vi.fn();
  render(
    <PureTaskRows
      rows={[]}
      planRowNumbers={planRowNumbers}
      canEdit
      isSaving={false}
      saveError={false}
      onSave={onSave}
      {...props}
    />,
  );
  return { onSave };
};

const openMenu = () => fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
const toggle = (n: number) => fireEvent.click(screen.getByText(String(n)));
const saveButton = () =>
  screen.getByRole('button', { name: 'TASK.ROWS.SAVE' }) as HTMLButtonElement;

afterEach(cleanup);

describe('PureTaskRows', () => {
  it('summarises the rows on the task', () => {
    setup({ rows: [row(12), row(13), row(14), row(15), row(21)], canEdit: false });
    expect(screen.getByText(/TASK\.ROWS\.SUMMARY/).textContent).toContain('"rows":"12-15,21"');
    expect(screen.getByText(/TASK\.ROWS\.SUMMARY/).textContent).toContain('"count":5');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('offers the rows of the plan in numeric order', () => {
    setup();
    openMenu();
    const labels = screen.getAllByRole('option').map((option) => option.textContent);
    expect(labels.slice(0, 3)).toEqual(['1', '2', '3']);
    expect(labels.indexOf('2')).toBeLessThan(labels.indexOf('10'));
  });

  it('saves the rows that were picked from the dropdown', () => {
    const { onSave } = setup();
    openMenu();
    [21, 12, 14, 13].forEach(toggle);
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledWith([12, 13, 14, 21]);
  });

  it('does not save an empty selection', () => {
    const { onSave } = setup({ rows: [row(1)] });
    openMenu();
    toggle(1);
    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('TASK.ROWS.ERRORS.EMPTY')).toBeTruthy();
  });

  it('does not save rows that are no longer in the plan', () => {
    const { onSave } = setup({ rows: [row(40)] });
    openMenu();
    toggle(2);
    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/TASK\.ROWS\.ERRORS\.NOT_IN_PLAN/).textContent).toContain(
      '"rows":"40"',
    );
  });

  it('keeps the save button off until the rows change', () => {
    setup({ rows: [row(1)] });
    expect(saveButton().disabled).toBe(true);
    openMenu();
    toggle(2);
    expect(saveButton().disabled).toBe(false);
    toggle(2);
    expect(saveButton().disabled).toBe(true);
  });

  it('locks the rows once any has a result', () => {
    setup({ rows: [row(1, 'done'), row(2)] });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('TASK.ROWS.LOCKED')).toBeTruthy();
    expect(screen.getByText(/TASK\.ROWS\.DONE/).textContent).toContain('"count":1');
  });

  it('shows a failed save', () => {
    setup({ saveError: true });
    expect(screen.getByText('TASK.ROWS.ERRORS.SAVE_FAILED')).toBeTruthy();
  });
});
