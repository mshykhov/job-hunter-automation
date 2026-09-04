import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type { RunnerSession } from "../api/job-hunter-client.js";
import { StaleGenerationError } from "../api/job-hunter-client.js";
import type {
  HeartbeatDraft,
  HeartbeatRequest,
  HeartbeatResponse,
} from "../domain/health.js";
import { RunnerSessionCoordinator } from "./session-coordinator.js";

export interface RunnerClient {
  startSession(): Promise<RunnerSession>;
  sendHeartbeat(request: HeartbeatRequest): Promise<HeartbeatResponse>;
}

export interface HeartbeatLoopOptions {
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now: () => Date;
  id: () => string;
}

const DEFAULT_OPTIONS: HeartbeatLoopOptions = {
  sleep: async (milliseconds, signal) => {
    await delay(milliseconds, undefined, { signal });
  },
  now: () => new Date(),
  id: randomUUID,
};

export class HeartbeatLoop {
  private currentSession: RunnerSession | undefined;
  private sequence = 0;
  private serialized: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: RunnerClient,
    private readonly collect: (
      session: RunnerSession,
      signal?: AbortSignal,
    ) => Promise<HeartbeatDraft>,
    private readonly options: HeartbeatLoopOptions = DEFAULT_OPTIONS,
    private readonly sessionCoordinator = new RunnerSessionCoordinator(client),
  ) {}

  runOnce(signal?: AbortSignal): Promise<void> {
    const execution = this.serialized.then(() => this.executeOnce(signal));
    this.serialized = execution.catch(() => undefined);
    return execution;
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!isAborted(signal)) {
      await this.runOnce(signal);
      if (!isAborted(signal)) {
        try {
          await this.options.sleep(
            (this.currentSession?.heartbeatIntervalSeconds ?? 60) * 1000,
            signal,
          );
        } catch (error) {
          if (!isAborted(signal)) throw error;
        }
      }
    }
  }

  private async executeOnce(signal?: AbortSignal): Promise<void> {
    this.currentSession = await this.sessionCoordinator.current();
    const draft = await this.collect(this.currentSession, signal);
    let request = this.request(
      draft,
      this.currentSession.generation,
      this.sequence + 1,
    );
    let retry = 0;

    for (;;) {
      try {
        const response = await this.client.sendHeartbeat(request);
        this.sequence = response.acceptedSequence;
        return;
      } catch (error) {
        if (error instanceof StaleGenerationError) {
          this.currentSession = await this.sessionCoordinator.refresh(
            request.generation,
          );
          this.sequence = 0;
          request = {
            ...request,
            generation: this.currentSession.generation,
            sequence: 1,
          };
          continue;
        }
        const backoff = BACKOFF_MILLISECONDS[retry];
        if (backoff === undefined) throw error;
        retry += 1;
        await this.options.sleep(backoff);
        request = { ...request, sentAt: this.options.now().toISOString() };
      }
    }
  }

  private request(
    draft: HeartbeatDraft,
    generation: number,
    sequence: number,
  ): HeartbeatRequest {
    return {
      ...draft,
      generation,
      sequence,
      idempotencyKey: this.options.id(),
      sentAt: this.options.now().toISOString(),
    };
  }
}

const BACKOFF_MILLISECONDS = [5_000, 15_000, 30_000, 60_000] as const;

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
