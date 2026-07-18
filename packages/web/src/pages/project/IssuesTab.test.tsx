import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { IssuesTab } from './IssuesTab.js';

const emptyTree = { tree: [], projects: [], agents: [], epics: [], stories: [], bugs: [] };

describe('Project IssuesTab', () => {
    it('mounts without crashing', () => {
        server.use(
            http.get('http://localhost:3000/api/issues/tree', () =>
                HttpResponse.json(emptyTree),
            ),
        );
        const { container } = renderWithProviders(
            <IssuesTab
                projectId="p1"
                treeData={emptyTree}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                formatRelative={() => 'just now'}
            />,
        );
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders skeleton (Skeleton elements) when treeData is undefined', () => {
        const { container } = renderWithProviders(
            <IssuesTab
                projectId="p1"
                treeData={undefined}
                agentsById={new Map()}
                ownerName="Bob"
                ownerAccent="#0A0A0A"
                formatRelative={() => 'just now'}
            />,
        );
        // When treeData is undefined the IssuesTabSkeleton renders 5 Skeleton elements
        const skeletons = container.querySelectorAll('.MuiSkeleton-root');
        expect(skeletons.length).toBeGreaterThan(0);
    });
});
