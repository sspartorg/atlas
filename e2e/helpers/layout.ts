import { expect, type Locator, type Page } from '@playwright/test';

// Geometry checks shared by the phone / tablet layout specs.

type Box = { x: number; y: number; width: number; height: number };

export function intersects(a: Box, b: Box): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export async function noHorizontalOverflow(page: Page): Promise<void> {
    const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
}

/** PageHeader: the action buttons sit on the title's row, right of it — not under the subtitle. */
export async function expectActionsOnTitleRow(page: Page): Promise<void> {
    const title = await page.locator('main header h1').boundingBox();
    const actions = await page.getByTestId('page-header-actions').boundingBox();
    expect(title, 'page title').toBeTruthy();
    expect(actions, 'header actions').toBeTruthy();
    const centre = actions!.y + actions!.height / 2;
    expect(centre, `actions centre ${centre} vs title ${title!.y}–${title!.y + title!.height}`).toBeGreaterThanOrEqual(title!.y);
    expect(centre).toBeLessThanOrEqual(title!.y + title!.height);
    expect(actions!.x).toBeGreaterThanOrEqual(title!.x + title!.width - 1);
}

/** Every rendered element inside each matched box stays inside that box. */
export async function expectBoxesContainTheirContent(boxes: Locator): Promise<void> {
    const escapes = await boxes.evaluateAll((els) =>
        els.flatMap((box, i) => {
            const c = box.getBoundingClientRect();
            return [...box.querySelectorAll('*')]
                // A tap's ripple is a circle clipped by its button; its raw box is bigger.
                .filter((el) => !el.closest('.MuiTouchRipple-root'))
                .map((el) => ({ el, r: el.getBoundingClientRect() }))
                .filter(({ r }) => r.width > 0 && r.height > 0)
                .filter(
                    ({ r }) =>
                        r.left < c.left - 1 || r.right > c.right + 1 || r.top < c.top - 1 || r.bottom > c.bottom + 1,
                )
                .map(({ el }) => `#${i}: <${el.tagName.toLowerCase()} class="${String(el.getAttribute('class')).slice(0, 60)}">`);
        }),
    );
    expect(escapes).toEqual([]);
}
