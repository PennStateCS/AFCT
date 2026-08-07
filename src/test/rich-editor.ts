/**
 * Test helper for the description editor, which the app loads on demand.
 *
 * `RichDescriptionField` pulls the editor in with a dynamic import so ProseMirror, Tiptap and
 * KaTeX stay off the routes students read. That is right for the app and awkward for tests: the
 * FIRST time a test file loads that module the transformer has to process the whole editor tree,
 * which regularly takes longer than a default `findBy`/`waitFor` timeout. The result is a test
 * that fails only when it is the first one to mount a description form.
 *
 * So any test that renders a form containing a description warms the module first. It costs one
 * import that the test was going to pay for anyway, and moves the wait out of the assertion.
 */
export async function warmRichDescriptionEditor(): Promise<void> {
  await import('@/components/rich-description/RichDescriptionEditor');
}

/**
 * Always pass this as the hook timeout:
 *
 *     beforeAll(warmRichDescriptionEditor, WARM_TIMEOUT_MS)
 *
 * The whole editor tree can take tens of seconds to transform when the full suite is running in
 * parallel, and a timed-out hook does not fail: Vitest marks that file's tests SKIPPED, which
 * still prints as a green summary. Coverage disappears and nothing says so. This is deliberately
 * far above the global hook timeout, because the cost here is a one-off import rather than
 * anything that could hang.
 */
export const WARM_TIMEOUT_MS = 120_000;
