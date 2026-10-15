import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Dialog from '@mui/material/Dialog';
import { installDialogEscapeFix } from './dialogEscape.js';

let uninstall: (() => void) | undefined;
afterEach(() => uninstall?.());

describe('installDialogEscapeFix', () => {
    it('closes the open dialog on Escape when focus has fallen to <body>', () => {
        uninstall = installDialogEscapeFix();
        const onClose = vi.fn();
        render(
            <Dialog open onClose={onClose}>
                <button>inside</button>
            </Dialog>
        );
        screen.getByText('inside').blur();
        (document.activeElement as HTMLElement | null)?.blur();
        expect(document.activeElement).toBe(document.body);
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('leaves other keys and the no-dialog case alone', () => {
        uninstall = installDialogEscapeFix();
        const onClose = vi.fn();
        render(
            <Dialog open onClose={onClose}>
                <button>inside</button>
            </Dialog>
        );
        (document.activeElement as HTMLElement | null)?.blur();
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(onClose).not.toHaveBeenCalled();
    });
});
