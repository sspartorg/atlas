import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePauseWhileTyping } from './usePauseWhileTyping.js';

function setup(enabled = true) {
    const player = { pause: vi.fn(), play: vi.fn() };
    renderHook(() => usePauseWhileTyping({ current: player }, enabled));
    return player;
}

describe('usePauseWhileTyping', () => {
    it('pauses when a text field gains focus and resumes when focus leaves editable content', () => {
        const player = setup();
        const input = document.createElement('input');
        const button = document.createElement('button');
        document.body.append(input, button);

        input.focus();
        expect(player.pause).toHaveBeenCalledTimes(1);

        button.focus();
        expect(player.play).toHaveBeenCalledTimes(1);
        input.remove();
        button.remove();
    });

    it('stays paused when focus moves between two text fields', () => {
        const player = setup();
        const a = document.createElement('textarea');
        const b = document.createElement('input');
        document.body.append(a, b);

        a.focus();
        b.focus();
        expect(player.play).not.toHaveBeenCalled();
        a.remove();
        b.remove();
    });

    it('does nothing when disabled (reduced motion keeps the player paused)', () => {
        const player = setup(false);
        const input = document.createElement('input');
        document.body.append(input);
        input.focus();
        input.blur();
        expect(player.pause).not.toHaveBeenCalled();
        expect(player.play).not.toHaveBeenCalled();
        input.remove();
    });
});
