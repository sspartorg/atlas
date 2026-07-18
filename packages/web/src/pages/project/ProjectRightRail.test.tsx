import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { ProjectRightRail } from './ProjectRightRail.js';

describe('ProjectRightRail', () => {
    it('mounts without crashing', () => {
        const { container } = renderWithProviders(
            <ProjectRightRail
                projectId="p1"
                activeAgents={[]}
                guardrailsMd=""
            />,
        );
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders empty agents message when activeAgents is empty (line 96)', () => {
        renderWithProviders(
            <ProjectRightRail
                projectId="p1"
                activeAgents={[]}
                guardrailsMd=""
            />,
        );
        expect(screen.getByText(/No agents assigned to this project yet/i)).toBeInTheDocument();
    });

    it('renders agent chips when activeAgents is non-empty (lines 100-132)', () => {
        const agent = makeAgent({ name: 'Coder', designation: 'Software Dev' });
        renderWithProviders(
            <ProjectRightRail
                projectId="p1"
                activeAgents={[agent]}
                guardrailsMd=""
            />,
        );
        // AgentChip renders in the active agents list
        expect(screen.getByText('Coder')).toBeInTheDocument();
    });

    it('shows "No rules set yet" when guardrailsMd is empty (line 165-168)', () => {
        renderWithProviders(
            <ProjectRightRail
                projectId="p1"
                activeAgents={[]}
                guardrailsMd=""
            />,
        );
        expect(screen.getByText(/No rules set yet/i)).toBeInTheDocument();
    });

    it('shows headingPreview when guardrailsMd has ## headings (lines 170-184)', () => {
        const guardrailsMd = '## Be concise\n## Stay focused\nSome content below.';
        renderWithProviders(
            <ProjectRightRail
                projectId="p1"
                activeAgents={[]}
                guardrailsMd={guardrailsMd}
            />,
        );
        // headingPreview is "## Be concise  ## Stay focused"
        expect(screen.getByText(/Be concise/)).toBeInTheDocument();
    });

    it('shows "Editor open in the Guard-rails tab" when guardrailsMd has content but no ## headings (lines 185-190)', () => {
        // hasGuardrails = true, headingPreview = '' (no ## lines)
        const guardrailsMd = 'Some guardrail content without headings.';
        renderWithProviders(
            <ProjectRightRail
                projectId="p1"
                activeAgents={[]}
                guardrailsMd={guardrailsMd}
            />,
        );
        expect(screen.getByText(/Editor open in the Guard-rails tab/i)).toBeInTheDocument();
    });

    it('calls onEditGuardrails when "Edit" button is clicked (line 142)', () => {
        const onEditGuardrails = vi.fn();
        renderWithProviders(
            <ProjectRightRail
                projectId="p1"
                activeAgents={[]}
                guardrailsMd=""
                onEditGuardrails={onEditGuardrails}
            />,
        );
        const editBtn = screen.getByText(/Edit/);
        fireEvent.click(editBtn);
        expect(onEditGuardrails).toHaveBeenCalled();
    });
});
