import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IProject, IWorkflow } from '@atlas/shared';
import { makeProject } from '../../test-utils/factories.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { StartInspector } from './StartInspector.js';

/**
 * The builder owns the workflow and feeds each patch straight back as new
 * props, so a controlled harness is the only faithful stand-in: it lets a
 * test both read the patch and see what the next render does with it (a
 * field that appears, a control that disappears).
 */
function mount(overrides: Partial<IWorkflow> = {}, projects: IProject[] = [makeProject()]) {
    const onChange = vi.fn();
    function Harness() {
        const [wf, setWf] = useState(() => makeWorkflow(overrides));
        return (
            <StartInspector
                workflow={wf}
                projects={projects}
                onChange={(patch) => {
                    onChange(patch);
                    setWf((prev) => ({ ...prev, ...patch }));
                }}
            />
        );
    }
    renderWithProviders(<Harness />);
    return onChange;
}

/** MUI selects open on mousedown, not click. */
function openSelect(label: RegExp | string) {
    fireEvent.mouseDown(screen.getByLabelText(label));
}

describe('StartInspector', () => {
    // ─── Name and description ───────────────────────────────────────────────

    // The API's name schema is `min(1)` after trimming, so a blank name is a
    // save that fails at the server. The field has to say so before then.
    it('flags a blank name, including one that is only whitespace', () => {
        mount({ name: '   ' });
        expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    });

    it('accepts a real name without flagging it', () => {
        mount({ name: 'Development' });
        expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false');
    });

    it('patches the name as typed', async () => {
        const onChange = mount({ name: 'Dev' });
        await userEvent.type(screen.getByLabelText('Name'), 'X');
        expect(onChange).toHaveBeenCalledWith({ name: 'DevX' });
    });

    // The column is nullable and the rest of the app checks `description` for
    // null; persisting '' would make an emptied description read as "set".
    it('clears the description to null rather than an empty string', async () => {
        const onChange = mount({ description: 'Code then review' });
        await userEvent.clear(screen.getByLabelText('Description'));
        expect(onChange).toHaveBeenCalledWith({ description: null });
    });

    // ─── Project ────────────────────────────────────────────────────────────

    it('shows the workflow project once the project list has loaded', () => {
        mount({ project_id: 'p1' }, [makeProject({ id: 'p1', name: 'Atlas' })]);
        expect(screen.getByLabelText('Project')).toHaveTextContent('Atlas');
    });

    // Projects arrive from a separate query. Between first paint and that
    // response the select holds an id with no matching option — MUI then warns
    // and renders the raw id, which is not a project name the Owner knows.
    it('renders no project while the list is still loading', () => {
        mount({ project_id: 'p1' }, []);
        expect(screen.getByLabelText('Project')).not.toHaveTextContent('p1');
    });

    it('patches the project id when another project is picked', async () => {
        const onChange = mount({ project_id: 'p1' }, [
            makeProject({ id: 'p1', name: 'Atlas' }),
            makeProject({ id: 'p2', name: 'Orion' }),
        ]);
        openSelect('Project');
        await userEvent.click(screen.getByRole('option', { name: 'Orion' }));
        expect(onChange).toHaveBeenCalledWith({ project_id: 'p2' });
    });

    // ─── Input kind ─────────────────────────────────────────────────────────

    it('marks the workflow input the workflow currently uses', () => {
        mount({ input_kind: 'item' });
        expect(screen.getByRole('button', { name: /Per Task/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /Project run/ })).toHaveAttribute('aria-pressed', 'false');
    });

    // A sub-task workflow never starts on its own — a Task run's Sub-tasks step
    // starts it. Leaving `item_ready` or `schedule` behind would arm a trigger
    // the runner can never honour, so the switch has to force `manual` and the
    // Trigger control has to go away with it.
    it('forces the trigger to manual and drops the Trigger control for a sub-task workflow', async () => {
        const onChange = mount({ input_kind: 'item', trigger: 'item_ready' });
        expect(screen.getByLabelText('Trigger')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /Sub-task workflow/ }));
        expect(onChange).toHaveBeenCalledWith({ input_kind: 'sub_task', trigger: 'manual' });
        expect(screen.queryByLabelText('Trigger')).toBeNull();
    });

    it('leaves the trigger alone for the other workflow inputs', async () => {
        const onChange = mount({ input_kind: 'item', trigger: 'item_ready' });
        await userEvent.click(screen.getByRole('button', { name: /Project run/ }));
        expect(onChange).toHaveBeenCalledWith({ input_kind: 'none' });
    });

    // ─── Trigger and schedule ───────────────────────────────────────────────

    // The API rejects `trigger: 'schedule'` with no preset, so picking
    // Scheduled has to seed one. Without the seed the Owner gets a 400 on save
    // from a form that looked complete.
    it('seeds a daily 09:00 schedule when Scheduled is picked with no preset', async () => {
        const onChange = mount({ trigger: 'manual', schedule_preset: null });
        openSelect('Trigger');
        await userEvent.click(screen.getByRole('option', { name: 'Scheduled' }));
        expect(onChange).toHaveBeenCalledWith({
            trigger: 'schedule',
            schedule_preset: 'daily',
            schedule_time_of_day: '09:00',
        });
    });

    // The same seed must not run a second time: it would silently throw away a
    // schedule the Owner already configured before flipping the trigger off.
    it('keeps an existing preset when Scheduled is picked again', async () => {
        const onChange = mount({
            trigger: 'manual',
            schedule_preset: 'weekly',
            schedule_weekday: 3,
            schedule_time_of_day: '17:30',
        });
        openSelect('Trigger');
        await userEvent.click(screen.getByRole('option', { name: 'Scheduled' }));
        expect(onChange).toHaveBeenCalledWith({ trigger: 'schedule' });
    });

    it('hides the schedule fields for a non-scheduled trigger', () => {
        mount({ trigger: 'item_ready', schedule_preset: 'daily' });
        expect(screen.queryByRole('button', { name: /Every hour/ })).toBeNull();
        expect(screen.queryByLabelText('Time of day')).toBeNull();
    });

    it('shows the preset cards for a scheduled trigger', () => {
        mount({ trigger: 'schedule', schedule_preset: 'daily' });
        expect(screen.getByRole('button', { name: /Every hour/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Daily/ })).toHaveAttribute('aria-pressed', 'true');
    });

    // Only daily and weekly runs happen at a time of day; asking for one on an
    // hourly schedule would be a setting the scheduler ignores.
    it('asks for a time of day only for the presets that have one', async () => {
        mount({ trigger: 'schedule', schedule_preset: 'hourly' });
        expect(screen.queryByLabelText('Time of day')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: /Weekly/ }));
        expect(screen.getByLabelText('Time of day')).toBeInTheDocument();
    });

    it('patches the time of day', () => {
        const onChange = mount({ trigger: 'schedule', schedule_preset: 'daily', schedule_time_of_day: '09:00' });
        fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: '06:45' } });
        expect(onChange).toHaveBeenCalledWith({ schedule_time_of_day: '06:45' });
    });

    it('clears an emptied time of day to null rather than an empty string', () => {
        const onChange = mount({ trigger: 'schedule', schedule_preset: 'daily', schedule_time_of_day: '09:00' });
        fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: '' } });
        expect(onChange).toHaveBeenCalledWith({ schedule_time_of_day: null });
    });

    // ─── Schedule patch mapping ─────────────────────────────────────────────
    //
    // SchedulePresetFields speaks its own shape (preset / weekday /
    // cronExpression) and this component translates it into workflow columns.
    // Each key is forwarded only when the patch carries it, so a translation
    // slip drops the field the Owner just changed.

    // Sunday is weekday 0, so the forward has to test `!== undefined` and not
    // truthiness — a truthiness check silently refuses to schedule on Sundays.
    it('forwards Sunday, whose weekday number is falsy', async () => {
        const onChange = mount({ trigger: 'schedule', schedule_preset: 'weekly', schedule_weekday: 3 });
        openSelect('Weekday');
        await userEvent.click(screen.getByRole('option', { name: 'Sun' }));
        expect(onChange).toHaveBeenCalledWith({ schedule_weekday: 0 });
    });

    it('forwards a custom cron expression', async () => {
        const onChange = mount({ trigger: 'schedule', schedule_preset: 'custom', cron_expr: '' });
        await userEvent.type(screen.getByLabelText('Cron expression'), '0');
        expect(onChange).toHaveBeenCalledWith({ cron_expr: '0' });
    });

    it('clears an emptied cron expression to null rather than an empty string', async () => {
        const onChange = mount({ trigger: 'schedule', schedule_preset: 'custom', cron_expr: '*/5 * * * *' });
        await userEvent.clear(screen.getByLabelText('Cron expression'));
        expect(onChange).toHaveBeenCalledWith({ cron_expr: null });
    });

    it('passes a preset change through to the workflow', async () => {
        const onChange = mount({ trigger: 'schedule', schedule_preset: 'daily' });
        await userEvent.click(screen.getByRole('button', { name: /Every 4 hours/ }));
        expect(onChange).toHaveBeenCalledWith({ schedule_preset: 'every_4h' });
    });

    // ─── Numeric limits ─────────────────────────────────────────────────────
    //
    // Both numbers are clamped in the handler rather than by the input's
    // min/max, because typing past the max in a number field does not fire a
    // validity error — it just hands the component an out-of-range value the
    // API would reject. `fireEvent.change` posts the whole value at once,
    // which is what a paste does.

    it('offers the parallel-run limit only for a per-Task workflow', () => {
        mount({ input_kind: 'none' });
        expect(screen.queryByLabelText('Tasks in parallel')).toBeNull();
    });

    it('clamps the parallel-run limit to the API maximum of 10', () => {
        const onChange = mount({ input_kind: 'item', max_parallel_runs: 1 });
        fireEvent.change(screen.getByLabelText('Tasks in parallel'), { target: { value: '99' } });
        expect(onChange).toHaveBeenCalledWith({ max_parallel_runs: 10 });
    });

    it('floors an emptied parallel-run limit at 1 instead of 0', () => {
        const onChange = mount({ input_kind: 'item', max_parallel_runs: 4 });
        fireEvent.change(screen.getByLabelText('Tasks in parallel'), { target: { value: '' } });
        expect(onChange).toHaveBeenCalledWith({ max_parallel_runs: 1 });
    });

    it('clamps max loops to 20 and floors it at 1', () => {
        const onChange = mount({ max_loops: 3 });
        const field = screen.getByLabelText('Max loops');
        fireEvent.change(field, { target: { value: '50' } });
        expect(onChange).toHaveBeenLastCalledWith({ max_loops: 20 });
        fireEvent.change(field, { target: { value: '0' } });
        expect(onChange).toHaveBeenLastCalledWith({ max_loops: 1 });
    });

    it('rounds a fractional loop count', () => {
        const onChange = mount({ max_loops: 3 });
        fireEvent.change(screen.getByLabelText('Max loops'), { target: { value: '2.6' } });
        expect(onChange).toHaveBeenCalledWith({ max_loops: 3 });
    });

    // ─── Active ─────────────────────────────────────────────────────────────

    // This switch is what stops a workflow picking up work; it has to map to
    // the status the runner reads, not to a boolean of its own.
    it('maps the Active switch to the workflow status in both directions', async () => {
        const onChange = mount({ status: 'active' });
        const active = screen.getByRole('switch');
        expect(active).toBeChecked();
        await userEvent.click(active);
        expect(onChange).toHaveBeenCalledWith({ status: 'inactive' });
        expect(active).not.toBeChecked();
        await userEvent.click(active);
        expect(onChange).toHaveBeenLastCalledWith({ status: 'active' });
    });
});
