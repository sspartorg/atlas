import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { makeWrapper } from '../test-utils/renderWithProviders.js';
import { useCredentials } from './useCredentials.js';

describe('useCredentials', () => {
    it('fetches the credentials list', async () => {
        server.use(http.get('http://localhost:3000/api/credentials', () => HttpResponse.json([])));
        const { result } = renderHook(() => useCredentials(), { wrapper: makeWrapper() });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual([]);
    });
});
