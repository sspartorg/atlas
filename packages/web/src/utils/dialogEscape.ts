// A dialog's submit button is disabled while its request runs, and a disabled
// button drops focus to <body> — outside the dialog, so MUI's Escape handler
// (on the dialog) never sees the next keypress and Escape needed two presses.
// When focus has fallen to <body> with a dialog open, hand Escape to the
// topmost dialog so it closes on the first press.
export function installDialogEscapeFix(doc: Document = document): () => void {
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || doc.activeElement !== doc.body) return;
        const dialogs = doc.querySelectorAll<HTMLElement>('.MuiDialog-root [role="dialog"]');
        const top = dialogs[dialogs.length - 1];
        if (!top) return;
        top.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
}
