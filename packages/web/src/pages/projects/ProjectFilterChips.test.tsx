import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { ProjectFilterChips } from './ProjectFilterChips.js';

describe('ProjectFilterChips', () => {
    it('renders chip labels with counts and fires onChange', async () => {
        const onChange = vi.fn();
        renderWithProviders(
            <ProjectFilterChips
                value="all"
                onChange={onChange}
                counts={{
                    all: 5,
                    mine: 2,
                    'software-dev': 3,
                    marketing: 0,
                    content: 0,
                    design: 0,
                }}
            />,
        );
        expect(screen.getByText('All')).toBeInTheDocument();
        await userEvent.click(screen.getByText('My queue'));
        expect(onChange).toHaveBeenCalledWith('mine');
    });
});
