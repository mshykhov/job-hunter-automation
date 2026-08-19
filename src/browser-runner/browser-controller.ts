import { normalize } from "node:path";

import { chromium as playwrightChromium } from "playwright";

interface BrowserPageHandle {
  setContent(html: string): Promise<void>;
  locator(selector: string): {
    getAttribute(name: string): Promise<string | null>;
  };
  close(): Promise<void>;
}

interface BrowserContextHandle {
  newPage(): Promise<BrowserPageHandle>;
  close(): Promise<void>;
}

export interface ChromiumLauncher {
  launchPersistentContext(
    profileDir: string,
    options: {
      channel: "chrome";
      headless: false;
      viewport: { width: number; height: number };
    },
  ): Promise<BrowserContextHandle>;
}

export class ChromeUnavailableError extends Error {
  constructor() {
    super("Dedicated Chrome context is unavailable");
    this.name = "ChromeUnavailableError";
  }
}

export class PlaywrightUnavailableError extends Error {
  constructor() {
    super("Playwright preflight marker is unavailable");
    this.name = "PlaywrightUnavailableError";
  }
}

export class BrowserController {
  private context: BrowserContextHandle | undefined;

  constructor(
    private readonly profileDir: string,
    private readonly chromium: ChromiumLauncher = playwrightChromium,
  ) {
    if (isDefaultChromeProfile(profileDir)) {
      throw new Error(
        "BROWSER_PROFILE_DIR must be a dedicated automation profile",
      );
    }
  }

  async preflight(): Promise<void> {
    const context = await this.contextHandle();
    const page = await context.newPage();
    try {
      await page.setContent("<main data-health='ready'>ready</main>");
      const marker = await page
        .locator("main[data-health='ready']")
        .getAttribute("data-health");
      if (marker !== "ready") throw new PlaywrightUnavailableError();
    } catch (error) {
      if (error instanceof PlaywrightUnavailableError) throw error;
      throw new PlaywrightUnavailableError();
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    const context = this.context;
    this.context = undefined;
    await context?.close();
  }

  private async contextHandle(): Promise<BrowserContextHandle> {
    if (this.context) return this.context;
    try {
      this.context = await this.chromium.launchPersistentContext(
        this.profileDir,
        {
          channel: "chrome",
          headless: false,
          viewport: { width: 1280, height: 900 },
        },
      );
      return this.context;
    } catch {
      throw new ChromeUnavailableError();
    }
  }
}

function isDefaultChromeProfile(profileDir: string): boolean {
  const path = normalize(profileDir)
    .toLowerCase()
    .replaceAll("\\", "/")
    .replace(/\/$/, "");
  return DEFAULT_PROFILE_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

const DEFAULT_PROFILE_SUFFIXES = [
  "/library/application support/google/chrome",
  "/appdata/local/google/chrome/user data",
  "/.config/google-chrome",
] as const;
