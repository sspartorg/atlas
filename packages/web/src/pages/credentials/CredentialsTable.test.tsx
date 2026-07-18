import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { CredentialsTable } from './CredentialsTable.js';
import type { ICredential } from '@atlas/shared';

const NOW = new Date().toISOString();
// 40 days ago
const FORTY_DAYS_AGO = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
// 10 days from now
const TEN_DAYS_FROM_NOW = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

const makeCred = (overrides: Partial<ICredential> = {}): ICredential => ({
    id: 'c1',
    label: 'My PAT',
    host: 'github',
    kind: 'pat',
    username: 'me',
    token_encrypted: 'enc',
    token_fingerprint: 'ghp_••••••••••••••••abcd',
    scope: 'repo',
    last_used_at: null,
    expires_at: null,
    app_id: null,
    has_app_private_key: false,
    app_installation_owner: null,
    app_installation_id: null,
    app_slug: null,
    human_name: null,
    human_email: null,
    human_gh_login: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
});

describe('CredentialsTable', () => {
    it('renders rows (active status, no expiry, no last_used_at)', () => {
        renderWithProviders(
            <CredentialsTable
                rows={[makeCred()]}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        expect(screen.getByText('My PAT')).toBeInTheDocument();
    });

    it('shows "Active" status chip when credential is active', () => {
        renderWithProviders(
            <CredentialsTable
                rows={[makeCred()]}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('shows "expiring" status when expires_at is within 60 days (covers expiring branch)', () => {
        renderWithProviders(
            <CredentialsTable
                rows={[makeCred({ expires_at: TEN_DAYS_FROM_NOW })]}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        // Status chip shows "Expires in X d"
        expect(document.body.textContent).toMatch(/Expires in \d+ d/);
    });

    it('shows "unused" status when last_used_at is 40+ days ago (covers unused with last_used_at branch)', () => {
        renderWithProviders(
            <CredentialsTable
                rows={[makeCred({ last_used_at: FORTY_DAYS_AGO })]}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        // Status shows "Unused X d"
        expect(document.body.textContent).toMatch(/Unused \d+ d/);
    });

    it('shows "unused" status when created_at is 40+ days ago and no last_used_at (covers created_at fallback branch)', () => {
        renderWithProviders(
            <CredentialsTable
                rows={[makeCred({ created_at: FORTY_DAYS_AGO, last_used_at: null })]}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        // deriveStatus: last_used_at is null, created_at is 40 days ago → kind=unused
        expect(document.body.textContent).toMatch(/Unused 30 d/);
    });

    it('renders multiple scope tags when scope has comma-separated values', () => {
        renderWithProviders(
            <CredentialsTable
                rows={[makeCred({ scope: 'repo,read:org' })]}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        expect(screen.getByText('repo')).toBeInTheDocument();
        expect(screen.getByText('read:org')).toBeInTheDocument();
    });

    it('calls onEdit when Edit button is clicked', () => {
        const onEdit = vi.fn();
        renderWithProviders(
            <CredentialsTable
                rows={[makeCred({ id: 'cred-test' })]}
                onEdit={onEdit}
                onDelete={vi.fn()}
            />,
        );
        // IconButton for Edit has an EditOutlined icon
        const editBtn = screen.getAllByRole('button')[0]!;
        fireEvent.click(editBtn);
        expect(onEdit).toHaveBeenCalledWith('cred-test');
    });
});
