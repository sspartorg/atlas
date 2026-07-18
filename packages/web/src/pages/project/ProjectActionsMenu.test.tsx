import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { ProjectActionsMenu } from './ProjectActionsMenu.js';

describe('ProjectActionsMenu', () => {
    it('opens menu and surfaces destructive Delete option', async () => {
        const onDelete = vi.fn();
        renderWithProviders(
            <ProjectActionsMenu
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={onDelete}
            />,
        );
        const triggers = screen.getAllByRole('button');
        await userEvent.click(triggers[0]!);
        const items = await screen.findAllByRole('menuitem');
        expect(items.length).toBeGreaterThan(0);
    });

    it('exercises pick(onRename) when Rename project is clicked', async () => {
        const onRename = vi.fn();
        renderWithProviders(
            <ProjectActionsMenu
                onRename={onRename}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        await userEvent.click(screen.getAllByRole('button')[0]!);
        const renameItem = await screen.findByText('Rename project…');
        fireEvent.click(renameItem);
        expect(onRename).toHaveBeenCalledOnce();
    });

    it('exercises pick(onEditGuardrails) when Edit guard-rails is clicked', async () => {
        const onEditGuardrails = vi.fn();
        renderWithProviders(
            <ProjectActionsMenu
                onRename={vi.fn()}
                onEditGuardrails={onEditGuardrails}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        await userEvent.click(screen.getAllByRole('button')[0]!);
        const item = await screen.findByText('Edit guard-rails');
        fireEvent.click(item);
        expect(onEditGuardrails).toHaveBeenCalledOnce();
    });

    it('exercises pick(onManageSecrets) when Manage Secrets is clicked', async () => {
        const onManageSecrets = vi.fn();
        renderWithProviders(
            <ProjectActionsMenu
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={onManageSecrets}
                onDelete={vi.fn()}
            />,
        );
        await userEvent.click(screen.getAllByRole('button')[0]!);
        const item = await screen.findByText('Manage Secrets');
        fireEvent.click(item);
        expect(onManageSecrets).toHaveBeenCalledOnce();
    });

    it('exercises pick(onDelete) when Delete project is clicked', async () => {
        const onDelete = vi.fn();
        renderWithProviders(
            <ProjectActionsMenu
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={onDelete}
            />,
        );
        await userEvent.click(screen.getAllByRole('button')[0]!);
        const item = await screen.findByText('Delete project…');
        fireEvent.click(item);
        expect(onDelete).toHaveBeenCalledOnce();
    });

    it('exercises close() by clicking outside the menu (onClose)', async () => {
        renderWithProviders(
            <ProjectActionsMenu
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        await userEvent.click(screen.getAllByRole('button')[0]!);
        await screen.findAllByRole('menuitem');
        // Press Escape to close the menu (triggers close())
        await userEvent.keyboard('{Escape}');
        await waitFor(() => {
            expect(screen.queryAllByRole('menuitem').length).toBe(0);
        });
    });

    it('renders onGenerateAiScaffold item when provided', async () => {
        const onGenerateAiScaffold = vi.fn();
        renderWithProviders(
            <ProjectActionsMenu
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
                onGenerateAiScaffold={onGenerateAiScaffold}
                aiScaffoldEnabled={true}
            />,
        );
        await userEvent.click(screen.getAllByRole('button')[0]!);
        const scaffoldItem = await screen.findByText('Generate AI scaffold…');
        expect(scaffoldItem).toBeInTheDocument();
        fireEvent.click(scaffoldItem);
        expect(onGenerateAiScaffold).toHaveBeenCalledOnce();
    });

    it('renders disabled Generate AI scaffold when aiScaffoldEnabled=false (line 86 disabled + line 173 Tooltip branch)', async () => {
        const onGenerateAiScaffold = vi.fn();
        renderWithProviders(
            <ProjectActionsMenu
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
                onGenerateAiScaffold={onGenerateAiScaffold}
                aiScaffoldEnabled={false}
            />,
        );
        await userEvent.click(screen.getAllByRole('button')[0]!);
        // The scaffold item is present but disabled
        const scaffoldItem = await screen.findByText('Generate AI scaffold…');
        expect(scaffoldItem).toBeInTheDocument();
        // Find the disabled menu item — it is wrapped in a Tooltip
        const menuItems = screen.getAllByRole('menuitem');
        const disabledItem = menuItems.find((el) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true');
        expect(disabledItem).toBeTruthy();
    });

    it('clicking a disabled menu item does NOT invoke onSelect (line 138 early-return branch)', async () => {
        const onGenerateAiScaffold = vi.fn();
        renderWithProviders(
            <ProjectActionsMenu
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
                onGenerateAiScaffold={onGenerateAiScaffold}
                aiScaffoldEnabled={false}
            />,
        );
        await userEvent.click(screen.getAllByRole('button')[0]!);
        const scaffoldItem = await screen.findByText('Generate AI scaffold…');
        // Click the disabled item's text — onClick fires but hits `if (it.disabled) return`
        fireEvent.click(scaffoldItem);
        // onGenerateAiScaffold must NOT be called (early return)
        expect(onGenerateAiScaffold).not.toHaveBeenCalled();
    });

    it('renders without onGenerateAiScaffold (false branch of line 79 spread conditional)', async () => {
        // When onGenerateAiScaffold is absent, no "Generate AI scaffold…" item appears
        renderWithProviders(
            <ProjectActionsMenu
                onRename={vi.fn()}
                onEditGuardrails={vi.fn()}
                onManageSecrets={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        await userEvent.click(screen.getAllByRole('button')[0]!);
        await screen.findAllByRole('menuitem');
        expect(screen.queryByText('Generate AI scaffold…')).not.toBeInTheDocument();
    });
});
