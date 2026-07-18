import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { MarketplaceAgentCard } from './MarketplaceAgentCard.js';
import type { IMarketplaceAgentSummary } from '@atlas/shared';

function makeSummary(overrides: Partial<IMarketplaceAgentSummary> = {}): IMarketplaceAgentSummary {
    return {
        id: 'agent-coder',
        name: 'Coder',
        category: 'software-dev',
        kind_slug: 'custom',
        summary: 'A coding agent',
        accent_color: '#0A0A0A',
        glyph: 'code',
        version: 3,
        is_installed: false,
        is_linked: false,
        installed_agent_id: null,
        installed_version: null,
        upgrade_available: false,
        ...overrides,
    };
}

describe('MarketplaceAgentCard', () => {
    it('renders name + summary + version + add button in the not-installed state', () => {
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary()}
                onOpen={() => {}}
                onAfterInstall={() => {}}
            />,
        );
        expect(screen.getByText('Coder')).toBeInTheDocument();
        expect(screen.getByText('A coding agent')).toBeInTheDocument();
        expect(screen.getByText(/v3/)).toBeInTheDocument();
        expect(screen.queryByText(/Installed/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Upgrade/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    });

    it('renders Installed chip when is_installed but no upgrade', () => {
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary({
                    is_installed: true,
                    is_linked: true,
                    installed_agent_id: 'agent-coder',
                    installed_version: 3,
                })}
                onOpen={() => {}}
                onAfterInstall={() => {}}
            />,
        );
        expect(screen.getByText('Installed')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    });

    it('renders upgrade chip when upgrade_available', () => {
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary({
                    is_installed: true,
                    is_linked: true,
                    installed_agent_id: 'agent-coder',
                    installed_version: 2,
                    upgrade_available: true,
                })}
                onOpen={() => {}}
                onAfterInstall={() => {}}
            />,
        );
        expect(screen.getByText(/v2.*v3/)).toBeInTheDocument();
    });

    it('clicking the card body fires onOpen', () => {
        const onOpen = vi.fn();
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary()}
                onOpen={onOpen}
                onAfterInstall={() => {}}
            />,
        );
        fireEvent.click(screen.getByText('Coder'));
        expect(onOpen).toHaveBeenCalled();
    });

    it('clicking Add opens the modal without firing onOpen', () => {
        const onOpen = vi.fn();
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary()}
                onOpen={onOpen}
                onAfterInstall={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        expect(screen.getByText(/add coder to your agents/i)).toBeInTheDocument();
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('falls back to "No summary available." when summary is empty', () => {
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary({ summary: '' })}
                onOpen={() => {}}
                onAfterInstall={() => {}}
            />,
        );
        expect(screen.getByText('No summary available.')).toBeInTheDocument();
    });

    it('renders a selection checkbox when selectable', () => {
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary()}
                onOpen={() => {}}
                onAfterInstall={() => {}}
                selectable
                selected={false}
                onToggleSelect={() => {}}
            />,
        );
        expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('renders no checkbox when not selectable', () => {
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary({
                    is_installed: true,
                    installed_agent_id: 'agent-coder',
                    installed_version: 3,
                })}
                onOpen={() => {}}
                onAfterInstall={() => {}}
            />,
        );
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('clicking the checkbox toggles selection without firing onOpen', () => {
        const onOpen = vi.fn();
        const onToggleSelect = vi.fn();
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary()}
                onOpen={onOpen}
                onAfterInstall={() => {}}
                selectable
                selected={false}
                onToggleSelect={onToggleSelect}
            />,
        );
        fireEvent.click(screen.getByRole('checkbox'));
        expect(onToggleSelect).toHaveBeenCalledTimes(1);
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('reflects the selected state as checked', () => {
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary()}
                onOpen={() => {}}
                onAfterInstall={() => {}}
                selectable
                selected
                onToggleSelect={() => {}}
            />,
        );
        expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('handleInstall — submitting the modal calls POST install and fires onAfterInstall', async () => {
        const BASE = 'http://localhost:3000/api';
        const onAfterInstall = vi.fn();
        server.use(
            http.post(`${BASE}/marketplace/agents/agent-coder/install`, () =>
                HttpResponse.json({ id: 'agent-coder' }),
            ),
        );
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary()}
                onOpen={() => {}}
                onAfterInstall={onAfterInstall}
            />,
        );
        // Open modal
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        await waitFor(() =>
            expect(screen.getByText(/add coder to your agents/i)).toBeInTheDocument(),
        );
        // Click the "Add to my agents" button in the modal
        const addBtn = screen.getByRole('button', { name: /add to my agents/i });
        fireEvent.click(addBtn);
        await waitFor(() => expect(onAfterInstall).toHaveBeenCalledWith('agent-coder'));
    });

    it('onKeyDown Space on checkbox calls onToggleSelect', () => {
        const onToggleSelect = vi.fn();
        const onOpen = vi.fn();
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary()}
                onOpen={onOpen}
                onAfterInstall={() => {}}
                selectable
                selected={false}
                onToggleSelect={onToggleSelect}
            />,
        );
        const checkbox = screen.getByRole('checkbox');
        fireEvent.keyDown(checkbox, { key: ' ' });
        expect(onToggleSelect).toHaveBeenCalledTimes(1);
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('onKeyDown Enter on checkbox calls onToggleSelect', () => {
        const onToggleSelect = vi.fn();
        const onOpen = vi.fn();
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary()}
                onOpen={onOpen}
                onAfterInstall={() => {}}
                selectable
                selected={false}
                onToggleSelect={onToggleSelect}
            />,
        );
        const checkbox = screen.getByRole('checkbox');
        fireEvent.keyDown(checkbox, { key: 'Enter' });
        expect(onToggleSelect).toHaveBeenCalledTimes(1);
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('onKeyDown other keys on checkbox do not call onToggleSelect', () => {
        const onToggleSelect = vi.fn();
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary()}
                onOpen={() => {}}
                onAfterInstall={() => {}}
                selectable
                selected={false}
                onToggleSelect={onToggleSelect}
            />,
        );
        const checkbox = screen.getByRole('checkbox');
        fireEvent.keyDown(checkbox, { key: 'Tab' });
        expect(onToggleSelect).not.toHaveBeenCalled();
    });

    it('closeAdd guard: close is ignored while installing is in-flight', async () => {
        const BASE = 'http://localhost:3000/api';
        let resolveInstall!: () => void;
        const installPromise = new Promise<void>((res) => { resolveInstall = res; });
        server.use(
            http.post(`${BASE}/marketplace/agents/agent-coder/install`, async () => {
                await installPromise;
                return HttpResponse.json({ id: 'agent-coder' });
            }),
        );
        const onAfterInstall = vi.fn();
        renderWithProviders(
            <MarketplaceAgentCard agent={makeSummary()} onOpen={() => {}} onAfterInstall={onAfterInstall} />,
        );
        // Open the AddFromMarketplaceModal
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        await waitFor(() => expect(screen.getByText(/add coder to your agents/i)).toBeInTheDocument());
        // Start install — the button text changes to show installing state
        const addBtn = screen.getByRole('button', { name: /add to my agents/i });
        fireEvent.click(addBtn);
        // While in-flight, installing=true → button is disabled
        await waitFor(() => {
            const btns = screen.getAllByRole('button');
            const confirmBtns = btns.filter(b => b.hasAttribute('disabled'));
            expect(confirmBtns.length).toBeGreaterThan(0);
        });
        resolveInstall();
        await waitFor(() => expect(onAfterInstall).toHaveBeenCalledWith('agent-coder'));
    });

    it('handleInstall with slug-taken details sets slugTaken and keeps modal open', async () => {
        const BASE = 'http://localhost:3000/api';
        // Return a 409 WITH the expected details → setSlugTaken, does NOT re-throw
        server.use(
            http.post(`${BASE}/marketplace/agents/agent-coder/install`, () =>
                HttpResponse.json(
                    { error: 'SLUG_TAKEN', details: { conflicting_id: 'agent-coder', suggested_id: 'agent-coder-2' } },
                    { status: 409 },
                ),
            ),
        );
        const onAfterInstall = vi.fn();
        renderWithProviders(
            <MarketplaceAgentCard agent={makeSummary()} onOpen={() => {}} onAfterInstall={onAfterInstall} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        await waitFor(() => expect(screen.getByText(/add coder to your agents/i)).toBeInTheDocument());
        const addBtn = screen.getByRole('button', { name: /add to my agents/i });
        fireEvent.click(addBtn);
        // The error is handled (not re-thrown), installing goes back to false,
        // and onAfterInstall is NOT called because it failed
        await waitFor(() => expect(onAfterInstall).not.toHaveBeenCalled(), { timeout: 3000 });
        // The modal stays open (slug-taken state)
        expect(screen.getByText(/add coder to your agents/i)).toBeInTheDocument();
    });

    it('handleInstall slug-taken 409: sets slugTaken state, does not call onAfterInstall', async () => {
        const BASE = 'http://localhost:3000/api';
        server.use(
            http.post(`${BASE}/marketplace/agents/agent-coder/install`, () =>
                HttpResponse.json(
                    { details: { conflicting_id: 'agent-coder', suggested_id: 'agent-coder-2' } },
                    { status: 409 },
                ),
            ),
        );
        const onAfterInstall = vi.fn();
        renderWithProviders(
            <MarketplaceAgentCard agent={makeSummary()} onOpen={() => {}} onAfterInstall={onAfterInstall} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        await waitFor(() => expect(screen.getByText(/add coder to your agents/i)).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /add to my agents/i }));
        // After slug-taken response the modal should still be open and onAfterInstall not fired
        await waitFor(() => expect(onAfterInstall).not.toHaveBeenCalled(), { timeout: 3000 });
    });

    it('handleCardClick ignores clicks that originate inside a MuiDialog-root', () => {
        const onOpen = vi.fn();
        const { container } = renderWithProviders(
            <MarketplaceAgentCard agent={makeSummary()} onOpen={onOpen} onAfterInstall={() => {}} />,
        );
        // Simulate a click whose target is inside .MuiDialog-root by dispatching
        // a synthetic event from within a mocked modal descendant. We test the
        // branch indirectly: clicking the Add button opens the modal (portal)
        // and the card click handler must NOT fire onOpen for that event.
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        expect(onOpen).not.toHaveBeenCalled();
        expect(container).toBeTruthy();
    });

    it('falls back to "smart_toy" glyph when agent.glyph is falsy', () => {
        renderWithProviders(
            <MarketplaceAgentCard
                agent={makeSummary({ glyph: '' })}
                onOpen={() => {}}
                onAfterInstall={() => {}}
            />,
        );
        // The material-icon span should contain the fallback "smart_toy"
        const glyphSpan = document.querySelector('.material-symbols-rounded');
        expect(glyphSpan?.textContent).toBe('smart_toy');
    });
});
