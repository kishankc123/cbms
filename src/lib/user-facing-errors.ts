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
      const message = decodeUserMessage(value);
      if (message) {
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
