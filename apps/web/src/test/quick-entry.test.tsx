import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { db } from '../data/db';
import { clearAll, setupInternship } from '../data/repo';

// Recharts measures the DOM; jsdom has no layout, so give it a size.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', RO);

async function freshInternship() {
  await clearAll();
  // Start the internship a month ago so today falls in the first (OMF) rotation.
  const start = new Date(Date.now() - 30 * 86_400_000);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  await setupInternship({
    internName: 'Dr Test Intern',
    facilityName: 'Test Hospital',
    periodFrom: iso,
    rotationOrder: ['OMF', 'PAED', 'PER', 'CONS', 'COMM'],
    supervisors: [{ name: 'Dr Sup', rotation: 'OMF' }],
  });
}

describe('Quick Entry', () => {
  beforeEach(async () => {
    await freshInternship();
  });

  it('logs an extraction in a few taps and shows the derived code before saving', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/log?procedure=extraction');
    render(<App />);

    const ref = await screen.findByPlaceholderText('OP-26-04417', {}, { timeout: 4000 });
    await user.type(ref, 'op-26-11111');
    await user.click(screen.getByRole('button', { name: 'Tooth 36' }));

    // The level is never pre-selected.
    const levels = screen.getByRole('radiogroup', { name: 'Your participation level' });
    expect(within(levels).getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
    await user.click(within(levels).getByRole('radio', { name: /Level 4/ }));

    const review = screen.getByRole('region', { name: 'What this entry will log' });
    expect(within(review).getByText(/Will log OMF 2 · 36/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await db.entries.count()).toBe(1));
    const entry = (await db.entries.toArray())[0]!;
    expect(entry).toMatchObject({ requirementCode: 'OMF 2', site: '36', levelClaimed: 4, status: 'submitted', patientRef: 'OP-26-11111' });
  });

  it('blocks saving until a level is chosen', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/log?procedure=extraction');
    render(<App />);
    await user.type(await screen.findByPlaceholderText('OP-26-04417', {}, { timeout: 4000 }), 'OP-26-2');
    await user.click(screen.getByRole('button', { name: 'Tooth 46' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/choose your participation level/i)).toBeInTheDocument();
    expect(await db.entries.count()).toBe(0);
  });

  it('warns when free text looks like a patient identifier', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/log?procedure=exam_plan');
    render(<App />);
    await screen.findByPlaceholderText('OP-26-04417', {}, { timeout: 4000 });
    await user.click(screen.getByRole('button', { name: /Diagnosis, investigations/ }));
    await user.type(screen.getByLabelText('Notes'), 'Call mother on 0712345678');
    expect(await screen.findByText(/looks like it contains a phone number/)).toBeInTheDocument();
  });
});
