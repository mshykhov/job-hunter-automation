import { describe, expect, it, vi } from "vitest";

import { AutomationLauncher, type SignalSource } from "../launcher.js";

describe("AutomationLauncher", () => {
  it("stops scheduling on SIGTERM and closes runtime resources", async () => {
    const handlers = new Map<NodeJS.Signals, () => void>();
    const on = vi.fn<SignalSource["on"]>((signal, handler) => {
      handlers.set(signal, handler);
    });
    const off = vi.fn<SignalSource["off"]>((signal) => {
      handlers.delete(signal);
    });
    const signals: SignalSource = {
      on,
      off,
    };
    const run = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", resolve, { once: true });
        }),
    );
    const close = vi.fn(() => Promise.resolve());
    const launcher = new AutomationLauncher(run, close, signals);

    const active = launcher.start();
    handlers.get("SIGTERM")?.();
    await active;

    expect(run.mock.calls[0]?.[0].aborted).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(off).toHaveBeenCalledTimes(2);
  });
});
