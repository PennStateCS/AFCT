/**
 * LTI Platform Storage: keeping a launch's state somewhere the browser will not throw away.
 *
 * The state cookie is what proves a returning launch is finishing in the browser that started
 * it. It has to be `SameSite=None` because the LMS posts the launch back from another site,
 * which makes it a third-party cookie, and a browser that blocks those outright drops it. Safari
 * does, and Chrome is heading the same way. The launch then fails for a reason the person cannot
 * do anything about.
 *
 * So the platform is asked to hold the value instead. Canvas exposes `localStorage` partitioned
 * per tool, addressed by `postMessage` to a frame it names in `lti_storage_target`, and that
 * storage belongs to the platform's origin rather than to AFCT's, so a browser has no reason to
 * block it.
 *
 * What this file holds is the browser half: it runs in a page, not on the server.
 *
 * **On how much this proves.** The cookie is strong because the browser supplies it by itself and
 * no other site can read it or plant it. This is weaker: the value comes back through a page, so
 * it says "a page running on AFCT's origin in this browser was handed this value by the platform"
 * rather than "this browser started this launch". It is used only where the cookie did not
 * arrive, which is the choice between this and nothing at all, and never in place of a cookie
 * that did. Anything that tightens that gap belongs here, with this comment.
 */

/** The `lti_storage_target` value Canvas defaults to, meaning `window.parent` itself. */
export const PARENT_TARGET = '_parent';

/** How long to wait for the platform to answer before giving up on it. */
export const STORAGE_TIMEOUT_MS = 2_000;

/**
 * The key a launch's state is stored under.
 *
 * Namespaced, because the storage is shared by everything AFCT puts there, and per state, so two
 * launches opened in two tabs do not overwrite one another: that was a real failure with a
 * single shared cookie name before, and the same shape of bug is available here.
 */
export function stateStorageKey(state: string): string {
  return `afct.state.${state}`;
}

type StorageMessage = {
  subject: string;
  key?: string;
  value?: string | null;
  message_id?: string;
  error?: { code?: string; message?: string };
};

/** Where to post, given what the platform said. Falls back to the parent with a wildcard. */
function targets(storageTarget: string | null, platformOrigin: string | null) {
  const frames: Array<{ frame: Window | null; origin: string }> = [];
  if (typeof window === 'undefined') return frames;

  const parent = window.parent;
  if (!parent) return frames;

  // A named frame, addressed at the platform's own origin, is what the spec asks for.
  if (storageTarget && storageTarget !== PARENT_TARGET) {
    const named = (parent.frames as unknown as Record<string, Window | undefined>)[storageTarget];
    if (named) frames.push({ frame: named, origin: platformOrigin ?? '*' });
  }
  // The parent with a wildcard is what Canvas still accepts, and the only thing that works when
  // the named frame is missing, which happens inside the rich content editor.
  frames.push({ frame: parent, origin: '*' });
  return frames;
}

/**
 * Send one message and wait for its answer, matched on `message_id`.
 *
 * Every message is answered on `window`, so replies to other messages arrive here too; the id is
 * what tells them apart. A missing answer is not an error worth showing anybody: it means this
 * platform does not do storage, and the caller carries on.
 */
async function exchange(
  message: StorageMessage,
  storageTarget: string | null,
  platformOrigin: string | null,
  timeoutMs = STORAGE_TIMEOUT_MS,
): Promise<StorageMessage | null> {
  const destinations = targets(storageTarget, platformOrigin);
  if (destinations.length === 0) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: StorageMessage | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      const data =
        typeof event.data === 'string'
          ? (() => {
              try {
                return JSON.parse(event.data) as StorageMessage;
              } catch {
                return null;
              }
            })()
          : (event.data as StorageMessage | null);
      if (!data || typeof data.subject !== 'string') return;
      if (data.subject !== `${message.subject}.response`) return;
      if (data.message_id !== message.message_id) return;
      finish(data);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener('message', onMessage);

    for (const destination of destinations) {
      try {
        destination.frame?.postMessage(message, destination.origin);
      } catch {
        // A frame that refuses the message is one fewer place to ask, not a failure.
      }
    }
  });
}

const newMessageId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `afct-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Ask the platform to remember a value. Resolves true only if it said it did.
 *
 * A false answer is not fatal anywhere it is called: the cookie may still work, and a launch
 * that cannot store its state fails later with a message about the browser rather than here,
 * where nobody could act on it.
 */
export async function putData(opts: {
  key: string;
  value: string;
  storageTarget: string | null;
  platformOrigin: string | null;
}): Promise<boolean> {
  const response = await exchange(
    {
      subject: 'lti.put_data',
      key: opts.key,
      value: opts.value,
      message_id: newMessageId(),
    },
    opts.storageTarget,
    opts.platformOrigin,
  );
  return !!response && !response.error && response.value === opts.value;
}

/** Ask the platform what it remembers. `null` covers "nothing" and "it did not answer". */
export async function getData(opts: {
  key: string;
  storageTarget: string | null;
  platformOrigin: string | null;
}): Promise<string | null> {
  const response = await exchange(
    {
      subject: 'lti.get_data',
      key: opts.key,
      message_id: newMessageId(),
    },
    opts.storageTarget,
    opts.platformOrigin,
  );
  if (!response || response.error) return null;
  return typeof response.value === 'string' ? response.value : null;
}
