import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { IMarketplaceAgentSummary, IPublishedWorkflow } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { makePublishedWorkflow, makeTemplates } from '../../test-utils/workflowFixtures.js';
import { Marketplace } from '../Marketplace.js';

const BASE = 'http://localhost:3000/api';

function catalogAgent(id: string, name: string): IMarketplaceAgentSummary {
    return {
        id,
        name,
        cli: 'claude',
        category: 'software-dev',
        kind_slug: 'custom',
        summary: '',
        accent_color: '#007AC9',
        glyph: 'code',
        version: 1,
        is_installed: false,
        is_linked: false,
        installed_agent_id: null,
        installed_version: null,
        upgrade_available: false,
    };
}

function mount(entry: string, published: IPublishedWorkflow[] = []) {
    server.use(
        http.get(`${BASE}/marketplace/workflows`, () => HttpResponse.json(published)),
        http.get(`${BASE}/agents`, () => HttpResponse.json([makeAgent({ id: 'agent-coder', name: 'My Coder' })])),
        http.get(`${BASE}/marketplace/agents`, () =>
            HttpResponse.json([catalogAgent('agent-po-writer', 'PO Writer'), catalogAgent('agent-coder', 'Coder')]),
        ),
        http.get(`${BASE}/workflows/templates`, () => HttpResponse.json(makeTemplates())),
    );
    renderWithProviders(
        <Routes>
            <Route path="/agents/marketplace" element={<Marketplace />} />
            <Route path="/agents/marketplace/workflows/:templateId" element={<p>Template detail</p>} />
            <Route path="/agents/marketplace/workflows/published/:publishedId" element={<p>Published detail</p>} />
        </Routes>,
        { initialEntries: [entry] },
    );
}

describe('Marketplace — Workflows tab', () => {
    it('switches from Agents to the shipped workflows', async () => {
        mount('/agents/marketplace');
        expect(screen.getByRole('heading', { name: 'Agent Marketplace' })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('tab', { name: 'Workflows' }));
        expect(screen.getByRole('heading', { name: 'Workflow Marketplace' })).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Delivery' })).toBeInTheDocument();
        expect(screen.getByText('2 starter workflows')).toBeInTheDocument();
    });

    it('shows each template with its delivery and every agent, sub-workflows included', async () => {
        mount('/agents/marketplace?tab=workflows');
        const starters = screen.getByRole('region', { name: 'Starter workflows' });
        const delivery = await within(starters).findByRole('button', { name: 'Delivery' });
        expect(within(delivery).getByText('Per Task · Push + PR')).toBeInTheDocument();
        expect(await within(delivery).findByText('PO Writer')).toBeInTheDocument();
        // Coder runs in the Build sub-workflow Delivery's Sub-tasks step uses.
        expect(within(delivery).getByText('Coder')).toBeInTheDocument();
        const build = screen.getByRole('button', { name: 'Build sub-task' });
        expect(within(build).getByText('Sub-task workflow · Back to the Task')).toBeInTheDocument();
    });

    it('opens a template’s detail page', async () => {
        mount('/agents/marketplace?tab=workflows');
        await userEvent.click(await screen.findByRole('button', { name: 'Delivery' }));
        expect(await screen.findByText('Template detail')).toBeInTheDocument();
    });
});

describe('Marketplace — Published by you', () => {
    it('lists the workflows you published with their date, your agent names first', async () => {
        const { graph: _graph, sub_workflows: _subs, ...entry } = makePublishedWorkflow();
        mount('/agents/marketplace?tab=workflows', [entry]);
        const mine = screen.getByRole('region', { name: 'Published by you' });
        const card = await within(mine).findByRole('button', { name: 'My delivery' });
        expect(within(card).getByText('Per Task · Push + PR')).toBeInTheDocument();
        expect(within(card).getByText('Sep 14', { exact: false })).toBeInTheDocument();
        expect(within(card).getByText('My Coder')).toBeInTheDocument();
        expect(await within(card).findByText('PO Writer')).toBeInTheDocument();
        expect(await screen.findByText('2 starter workflows · 1 published')).toBeInTheDocument();

        await userEvent.click(card);
        expect(await screen.findByText('Published detail')).toBeInTheDocument();
    });

    it('says how to publish one when there are none', async () => {
        mount('/agents/marketplace?tab=workflows');
        const mine = screen.getByRole('region', { name: 'Published by you' });
        expect(await within(mine).findByText('Publish a workflow from its builder to list it here.')).toBeInTheDocument();
    });
});
