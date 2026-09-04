import type { RunnerSession } from "../api/job-hunter-client.js";

export interface RunnerSessionClient {
  startSession(): Promise<RunnerSession>;
}

export class RunnerSessionCoordinator {
  private session: RunnerSession | undefined;
  private serialized: Promise<void> = Promise.resolve();

  constructor(private readonly client: RunnerSessionClient) {}

  current(): Promise<RunnerSession> {
    return this.serialize(async () => {
      this.session ??= await this.client.startSession();
      return this.session;
    });
  }

  refresh(staleGeneration: number): Promise<RunnerSession> {
    return this.serialize(async () => {
      if (
        this.session === undefined ||
        this.session.generation === staleGeneration
      )
        this.session = await this.client.startSession();
      return this.session;
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const execution = this.serialized.then(operation);
    this.serialized = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }
}
