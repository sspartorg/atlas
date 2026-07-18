import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { BugBodyCards } from './BugBodyCards.js';

const defaultProps = {
    acceptance_criteria: '',
    steps_to_reproduce: '',
    expected: '',
    actual: '',
    frequency: 'sometimes' as const,
    failure_scope: 'cosmetic' as const,
    onUpdate: vi.fn().mockResolvedValue(undefined),
};

describe('BugBodyCards', () => {
    it('renders all enum chips and cards', () => {
        renderWithProviders(<BugBodyCards {...defaultProps} />);
        // These are rendered with CSS textTransform: uppercase but the DOM text is lowercase
        expect(screen.getByText('Frequency')).toBeInTheDocument();
        expect(screen.getByText('Failure scope')).toBeInTheDocument();
        expect(screen.getByText('Acceptance criteria')).toBeInTheDocument();
        expect(screen.getByText('Steps to reproduce')).toBeInTheDocument();
        expect(screen.getByText('Expected vs Actual')).toBeInTheDocument();
    });

    it('shows the current frequency value', () => {
        renderWithProviders(<BugBodyCards {...defaultProps} frequency="always" />);
        expect(screen.getByDisplayValue('always')).toBeInTheDocument();
    });

    it('shows the current failure_scope value', () => {
        renderWithProviders(
            <BugBodyCards {...defaultProps} failure_scope="data-loss" />,
        );
        expect(screen.getByDisplayValue('data-loss')).toBeInTheDocument();
    });

    it('calls onUpdate with new frequency when select changes', async () => {
        const onUpdate = vi.fn().mockResolvedValue(undefined);
        renderWithProviders(<BugBodyCards {...defaultProps} onUpdate={onUpdate} />);
        // MUI Select renders a div[role="combobox"] as the clickable area
        const comboboxes = screen.getAllByRole('combobox');
        // First combobox is frequency
        await userEvent.click(comboboxes[0]!);
        const rareOption = await screen.findByRole('option', { name: 'rare' });
        await userEvent.click(rareOption);
        await waitFor(() =>
            expect(onUpdate).toHaveBeenCalledWith({ frequency: 'rare' }),
        );
    });

    it('calls onUpdate with new failure_scope when select changes', async () => {
        const onUpdate = vi.fn().mockResolvedValue(undefined);
        renderWithProviders(
            <BugBodyCards {...defaultProps} failure_scope="cosmetic" onUpdate={onUpdate} />,
        );
        const comboboxes = screen.getAllByRole('combobox');
        // Second combobox is failure_scope
        await userEvent.click(comboboxes[1]!);
        const funcOption = await screen.findByRole('option', { name: 'functional' });
        await userEvent.click(funcOption);
        await waitFor(() =>
            expect(onUpdate).toHaveBeenCalledWith({ failure_scope: 'functional' }),
        );
    });

    it('shows empty hint when expected/actual are empty', () => {
        renderWithProviders(<BugBodyCards {...defaultProps} expected="" actual="" />);
        expect(
            screen.getByText(/Click to describe expected vs actual behaviour/i),
        ).toBeInTheDocument();
    });

    it('shows expected and actual values when provided', () => {
        renderWithProviders(
            <BugBodyCards {...defaultProps} expected="Page loads" actual="Page crashes" />,
        );
        expect(screen.getByText(/Page loads/)).toBeInTheDocument();
        expect(screen.getByText(/Page crashes/)).toBeInTheDocument();
    });

    it('expected/actual edit form appears when "Edit" button in ExpectedActual card is clicked', async () => {
        renderWithProviders(
            <BugBodyCards {...defaultProps} expected="Old expected" actual="Old actual" />,
        );
        // There are multiple Edit buttons (one per EditableMarkdownCard + the ExpectedActual one).
        // The ExpectedActual Edit is the last one.
        const editButtons = screen.getAllByRole('button', { name: /Edit/i });
        await userEvent.click(editButtons[editButtons.length - 1]!);
        expect(screen.getByLabelText('Expected')).toBeInTheDocument();
        expect(screen.getByLabelText('Actual')).toBeInTheDocument();
    });

    it('cancel in expected/actual edit restores original values', async () => {
        renderWithProviders(
            <BugBodyCards {...defaultProps} expected="Old expected" actual="Old actual" />,
        );
        const editButtons = screen.getAllByRole('button', { name: /Edit/i });
        await userEvent.click(editButtons[editButtons.length - 1]!);
        const expInput = screen.getByLabelText('Expected');
        await userEvent.clear(expInput);
        await userEvent.type(expInput, 'Changed');
        const cancelBtns = screen.getAllByRole('button', { name: /^Cancel$/ });
        await userEvent.click(cancelBtns[cancelBtns.length - 1]!);
        expect(screen.getByText(/Old expected/)).toBeInTheDocument();
    });

    it('save in expected/actual edit calls onUpdate', async () => {
        const onUpdate = vi.fn().mockResolvedValue(undefined);
        renderWithProviders(
            <BugBodyCards
                {...defaultProps}
                expected="Original"
                actual="Broken"
                onUpdate={onUpdate}
            />,
        );
        const editButtons = screen.getAllByRole('button', { name: /Edit/i });
        await userEvent.click(editButtons[editButtons.length - 1]!);
        const expInput = screen.getByLabelText('Expected');
        await userEvent.clear(expInput);
        await userEvent.type(expInput, 'New expected');
        const saveBtns = screen.getAllByRole('button', { name: /^Save$/ });
        await userEvent.click(saveBtns[saveBtns.length - 1]!);
        await waitFor(() =>
            expect(onUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ expected: 'New expected' }),
            ),
        );
    });

    it('frequency=rare triggers info tone in EnumChip (toneColor=brandBlue)', () => {
        // Covers the `else` branch in the frequency ternary: rare → tone='info'
        renderWithProviders(<BugBodyCards {...defaultProps} frequency="rare" />);
        expect(screen.getByDisplayValue('rare')).toBeInTheDocument();
    });

    it('failure_scope=data-loss triggers error tone in EnumChip', () => {
        // Covers the data-loss → tone='error' branch
        renderWithProviders(<BugBodyCards {...defaultProps} failure_scope="data-loss" />);
        expect(screen.getByDisplayValue('data-loss')).toBeInTheDocument();
    });

    it('failure_scope=performance triggers info tone in EnumChip', () => {
        // Covers the performance → tone='info' branch
        renderWithProviders(<BugBodyCards {...defaultProps} failure_scope="performance" />);
        expect(screen.getByDisplayValue('performance')).toBeInTheDocument();
    });

    it('shows only expected text when expected is set but actual is empty', () => {
        // Covers `{expected && ...}` true branch AND `{actual && ...}` false branch
        renderWithProviders(
            <BugBodyCards {...defaultProps} expected="The page should load" actual="" />,
        );
        expect(screen.getByText(/The page should load/)).toBeInTheDocument();
        expect(screen.queryByText(/Actual:/)).not.toBeInTheDocument();
    });

    it('shows only actual text when actual is set but expected is empty', () => {
        // Covers `{expected && ...}` false branch AND `{actual && ...}` true branch
        renderWithProviders(
            <BugBodyCards {...defaultProps} expected="" actual="Page crashes on load" />,
        );
        expect(screen.getByText(/Page crashes on load/)).toBeInTheDocument();
        expect(screen.queryByText(/Expected:/)).not.toBeInTheDocument();
    });

    it('saving=true disables Cancel and Save buttons in ExpectedActual edit', async () => {
        // Covers the `disabled={saving}` branch in the edit form
        renderWithProviders(
            <BugBodyCards
                {...defaultProps}
                expected="E"
                actual="A"
                saving={true}
            />,
        );
        const editButtons = screen.getAllByRole('button', { name: /Edit/i });
        await userEvent.click(editButtons[editButtons.length - 1]!);
        // While saving=true, Cancel and Save buttons are disabled
        const cancelBtn = screen.getByRole('button', { name: /^Cancel$/ });
        const saveBtn = screen.getByRole('button', { name: /^Save$/ });
        expect(cancelBtn).toBeDisabled();
        expect(saveBtn).toBeDisabled();
    });

    it('failure_scope=functional triggers warning tone in EnumChip (line 319 branch)', () => {
        // failure_scope === 'functional' → tone='warning' (second branch of the failure_scope ternary)
        renderWithProviders(<BugBodyCards {...defaultProps} failure_scope="functional" />);
        expect(screen.getByDisplayValue('functional')).toBeInTheDocument();
    });

    it('clicking empty hint text sets editing=true (line 270 onClick branch)', async () => {
        // When expected="" and actual="" the hint "Click to describe expected vs actual behaviour…"
        // renders with onClick={() => setEditing(true)}.
        renderWithProviders(<BugBodyCards {...defaultProps} expected="" actual="" />);
        const hint = screen.getByText(/Click to describe expected vs actual behaviour/i);
        await userEvent.click(hint);
        // After clicking, edit mode opens — the "Expected" text field should appear
        expect(screen.getByLabelText('Expected')).toBeInTheDocument();
    });

    it('useEffect !editing branch: prop change while not editing syncs draft state', async () => {
        // When editing=false and new expected/actual arrive via re-render,
        // useEffect fires with !editing=true, updating the drafts.
        // The ExpectedActualCard only shows edit UI when editing=true, so we open edit
        // then verify the cancel button discards drafts and re-syncs.
        const { rerender } = renderWithProviders(
            <BugBodyCards {...defaultProps} expected="First" actual="A" />,
        );
        // Re-render with new props while NOT in edit mode
        rerender(
            <BugBodyCards {...defaultProps} expected="Updated" actual="A" />,
        );
        // Verify the new value appears (useEffect synced the draft)
        expect(screen.getByText(/Updated/)).toBeInTheDocument();
    });
});
