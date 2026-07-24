import { JsToSwiftMessage } from "./protocol.js";
import { NativeBridge, NativeBridgeEngine, NativeBridgeEngineOptions } from "./native-bridge-engine.js";

type WebKitMessageHandler = {
  postMessage(message: unknown): void;
};

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        kineticRouter?: WebKitMessageHandler;
      };
    };
  }
}

/** True when running inside a kinetic-router native shell. Deterministic:
 *  the shell registers the `kineticRouter` message handler before any script
 *  runs. The user-agent suffix (`KineticNative/<version>`) is checked as a
 *  sanity guard against unrelated hosts exposing the same handler name. */
export function isNativeShell(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.webkit?.messageHandlers?.kineticRouter !== undefined &&
    navigator.userAgent.includes('KineticNative/')
  );
}

/** The production NativeBridge: posts messages to the shell via
 *  `window.webkit.messageHandlers.kineticRouter`. Throws when not running
 *  inside the shell — check `isNativeShell()` first. */
export function createWebKitBridge(): NativeBridge {
  const handler = window.webkit?.messageHandlers?.kineticRouter;
  if (handler === undefined) {
    throw new Error('Not running inside a kinetic-router native shell');
  }

  return {
    postMessage(message: JsToSwiftMessage) {
      handler.postMessage(message);
    },
  };
}

/** The runtime switch that keeps app code environment-agnostic: returns a
 *  `NativeBridgeEngine` when running inside the native shell, otherwise
 *  `undefined` (so `new Router(sitemap, { engine })` falls back to the
 *  default `NavigationApiEngine`).
 *
 *  ```ts
 *  const router = new Router(sitemap, { engine: detectNativeEngine({ sitemap }) });
 *  ```
 */
export function detectNativeEngine(
  options: Omit<NativeBridgeEngineOptions, 'bridge'>
): NativeBridgeEngine | undefined {
  if (!isNativeShell()) return undefined;
  return new NativeBridgeEngine({ ...options, bridge: createWebKitBridge() });
}
