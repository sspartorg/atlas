// Returns `true` immediately — render tab content synchronously.
//
// Previous behavior: deferred mount by one macrotask to show a skeleton first.
// That produced a visible skeleton flash on every tab switch and was the main
// source of "tab switching feels laggy" complaints. If a specific tab's
// content turns out to be genuinely slow, memoize that tab's children instead
// of masking the cost with a skeleton flash.
export function useDeferredMount(): boolean {
    return true;
}
