import { useEffect, type RefObject } from 'react';

interface IPausablePlayer {
    pause: () => void;
    play: () => void;
}

function isEditable(el: EventTarget | null): boolean {
    return (
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    );
}

// The header mascot's Lottie loop runs on the main thread; while it animates,
// fast keystroke bursts into controlled inputs get dropped. Pausing it while a
// text field has focus removes that contention.
export function usePauseWhileTyping(player: RefObject<IPausablePlayer | null>, enabled: boolean) {
    useEffect(() => {
        if (!enabled) return;
        const onFocusIn = (e: FocusEvent) => {
            if (isEditable(e.target)) player.current?.pause();
        };
        const onFocusOut = (e: FocusEvent) => {
            if (isEditable(e.target) && !isEditable(e.relatedTarget)) player.current?.play();
        };
        document.addEventListener('focusin', onFocusIn);
        document.addEventListener('focusout', onFocusOut);
        return () => {
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('focusout', onFocusOut);
        };
    }, [player, enabled]);
}
