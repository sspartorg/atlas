import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'atlas.agentFavorites';

function readStored(): string[] {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed)
            ? parsed.filter((x): x is string => typeof x === 'string')
            : [];
    } catch {
        return [];
    }
}

export function useAgentFavorites() {
    const [ids, setIds] = useState<string[]>(() => readStored());

    useEffect(() => {
        function onStorage(e: StorageEvent) {
            if (e.key === STORAGE_KEY) setIds(readStored());
        }
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const persist = useCallback((next: string[]) => {
        setIds(next);
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
            // ignore quota / disabled storage
        }
    }, []);

    const isFav = useCallback((id: string) => ids.includes(id), [ids]);

    const toggle = useCallback(
        (id: string) => {
            persist(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
        },
        [ids, persist]
    );

    return { ids, isFav, toggle, count: ids.length };
}
