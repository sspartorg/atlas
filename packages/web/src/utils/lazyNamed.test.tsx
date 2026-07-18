import { Suspense } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { lazyNamed } from './lazyNamed.js';

describe('lazyNamed', () => {
    it('rebrands a named export as default for React.lazy', async () => {
        const Greeting = lazyNamed(
            () => Promise.resolve({ Greeting: () => <div>hello-named</div> }),
            'Greeting',
        );
        render(
            <Suspense fallback={<div>loading</div>}>
                <Greeting />
            </Suspense>,
        );
        expect(await screen.findByText('hello-named')).toBeInTheDocument();
    });
});
