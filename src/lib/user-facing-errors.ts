// Shows the real reason an action failed, in production too.
//
// Next.js hides the message of any error thrown by a server action in production builds (the browser only gets
// "Minified React error #441"), because an unexpected error's message could leak internals. But our own
// rule messages ("Bill number SB-1 is already recorded for this supplier", "Select a supplier") are meant for the
// person. Next sends along a `digest` string for every server error and keeps one that is already set, so:
//
//   server: a plain `throw new Error("...")` gets a digest that carries its message (installServerErrorMessages)
//   client: when React assigns that digest to the error it builds, the message is restored (installClientErrorMessages)
//
// so every existing `catch (e) { show(e.message) }` shows the cause without any call site changing. Database,
// library and framework errors are deliberately left hidden (see isUserFacingError).

const PREFIX = "ue1:";
const MAX_LENGTH = 500;

export function encodeUserMessage(message: string): string {
  return PREFIX + encodeURIComponent(message.slice(0, MAX_LENGTH));
}

export function decodeUserMessage(digest: unknown): string | null {
  if (typeof digest !== "string" || !digest.startsWith(PREFIX)) return null;
  try {
    return decodeURIComponent(digest.slice(PREFIX.length));
  } catch {
    return null;
  }
}

/**
 * Only a plain `Error` raised by our own code is safe to show. Anything with a database code or a cause, any subclass
 * (TypeError, driver and framework errors) and a failed SQL statement (whose message includes the query and its
 * values) stay hidden behind the generic message.
 */
export function isUserFacingError(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  if (Object.getPrototypeOf(err) !== Error.prototype) return false;
  if ("cause" in err || "code" in err || "query" in err) return false;
  const message = err.message.trim();
  return message.length > 0 && !/^failed query/i.test(message);
}

// What the framework or the network says when something unexpected went wrong. None of it means anything to the person.
const HIDDEN_BY_FRAMEWORK = /^Minified React error #\d+|An error occurred in the Server Components render|a (server|client)-side exception has occurred/i;
const NETWORK_PROBLEM = /^(Failed to fetch|NetworkError|Load failed|Network request failed)/i;

/**
 * The words to show for any failure: our own rule messages pass through unchanged; a framework placeholder ("Minified React
 * error #441") or a network failure becomes a plain sentence. `reference` is the code the server logged for that error, so
 * whoever looks into it can find the real cause.
 */
export function friendlyMessage(message: string, reference?: unknown): string {
  if (NETWORK_PROBLEM.test(message)) return "We could not reach the server. Check your internet connection and try again.";
  if (!HIDDEN_BY_FRAMEWORK.test(message)) return message;
  const ref = typeof reference === "string" && reference && !reference.startsWith(PREFIX) ? ` Reference: ${reference}.` : "";
  return `Something went wrong on our side, so this could not be completed. Please check whether it was saved, then try again. If it keeps happening, tell support.${ref}`;
}

type WithDigest = Error & { digest?: unknown };

/** Server: give each user-facing error a digest that carries its message. Safe to call more than once. */
export function installServerErrorMessages() {
  const proto = Error.prototype as unknown as Record<string, unknown>;
  if ((proto as { __ueServer?: boolean }).__ueServer) return;
  Object.defineProperty(Error.prototype, "__ueServer", { value: true });
  Object.defineProperty(Error.prototype, "digest", {
    configurable: true,
    get(this: Error) {
      return isUserFacingError(this) ? encodeUserMessage(this.message) : undefined;
    },
    // Next stamps its own digest on other errors by assignment; that must still work.
    set(this: Error, value: unknown) {
      Object.defineProperty(this, "digest", { value, writable: true, configurable: true, enumerable: true });
    },
  });
}

/** Browser: when React attaches a digest to the error it builds, restore the message that digest carries. */
export function installClientErrorMessages() {
  const flag = "__ueClient";
  if (typeof window === "undefined" || (window as unknown as Record<string, unknown>)[flag]) return;
  (window as unknown as Record<string, unknown>)[flag] = true;
  Object.defineProperty(Error.prototype, "digest", {
    configurable: true,
    get() {
      return undefined;
    },
    set(this: WithDigest, value: unknown) {
      Object.defineProperty(this, "digest", { value, writable: true, configurable: true, enumerable: true });
      // Our own message when the server sent one; otherwise a plain sentence in place of the framework's placeholder.
      const message = decodeUserMessage(value) ?? friendlyMessage(this.message, value);
      if (message !== this.message) {
        try {
          this.message = message;
          this.stack = `Error: ${message}`;
        } catch {
          /* a frozen error keeps its generic message */
        }
      }
    },
  });
}
