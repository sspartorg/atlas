import { describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { HistoryTab } from './HistoryTab.js';

// useDeferredMount currently returns `true` synchronously — mock to exercise
// both branches from this file's perspective.
vi.mock('../../hooks/useDeferredMount.js', () => ({
    useDeferredMount: vi.fn(),
}));

import { useDeferredMount } from '../../hooks/useDeferredMount.js';
const mockMount = vi.mocked(useDeferredMount);

const BASE = 'http://localhost:3000/api';

describe('Project HistoryTab', () => {
    it('mounts without crashing', () => {
        mockMount.mockReturnValue(true);
        server.use(
            http.get(`${BASE}/run`, () => HttpResponse.json([])),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        const { container } = renderWithProviders(<HistoryTab projectId="p1" />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders the skeleton when useDeferredMount returns false (!ready guard)', () => {
        mockMount.mockReturnValue(false);
        renderWithProviders(<HistoryTab projectId="p1" />);
        const skeletons = document.querySelectorAll('.MuiSkeleton-root');
        expect(skeletons.length).toBeGreaterThan(0);
    });

    it('renders HistoryTabContent (not skeleton) when ready is true', async () => {
        mockMount.mockReturnValue(true);
        server.use(
            http.get(`${BASE}/run`, () => HttpResponse.json([])),
            http.get(`${BASE}/agents`, () => HttpResponse.json([])),
        );
        renderWithProviders(<HistoryTab projectId="p1" />);
        // When ready, no skeleton blocks should appear; content area renders
        await waitFor(() => {
            expect(document.querySelectorAll('.MuiSkeleton-root').length).toBe(0);
        });
    });
});
