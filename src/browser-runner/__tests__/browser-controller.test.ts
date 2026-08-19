import { describe, expect, it, vi } from "vitest";

import { BrowserController } from "../browser-controller.js";

describe("BrowserController", () => {
  it("opens a dedicated headed Chrome persistent context and keeps it alive between probes", async () => {
    const marker = { getAttribute: vi.fn(() => Promise.resolve("ready")) };
    const page = {
      setContent: vi.fn(() => Promise.resolve()),
      locator: vi.fn(() => marker),
      close: vi.fn(() => Promise.resolve()),
    };
    const context = {
      newPage: vi.fn(() => Promise.resolve(page)),
      close: vi.fn(() => Promise.resolve()),
    };
    const chromium = {
      launchPersistentContext: vi.fn(() => Promise.resolve(context)),
    };
    const controller = new BrowserController(
      "/var/lib/job-hunter-automation/chrome-profile",
      chromium,
    );

    await controller.preflight();
    await controller.preflight();

    expect(chromium.launchPersistentContext).toHaveBeenCalledOnce();
    expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
      "/var/lib/job-hunter-automation/chrome-profile",
      {
        channel: "chrome",
        headless: false,
        viewport: { width: 1280, height: 900 },
      },
    );
    expect(page.setContent).toHaveBeenCalledWith(
      "<main data-health='ready'>ready</main>",
    );
    expect(page.close).toHaveBeenCalledTimes(2);
    expect(context.close).not.toHaveBeenCalled();

    await controller.close();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("rejects an operating-system default Chrome profile", () => {
    expect(
      () =>
        new BrowserController(
          "/Users/alice/Library/Application Support/Google/Chrome",
          { launchPersistentContext: vi.fn() },
        ),
    ).toThrow(/dedicated/);
  });
});
