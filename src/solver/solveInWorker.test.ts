import { afterEach, describe, expect, it } from "vitest";
import { solve, type SolverInput, type SolverResult } from "./solve";
import { solveInWorker } from "./solveInWorker";

function baseInput(overrides: Partial<SolverInput> = {}): SolverInput {
  return {
    slots: { space: 5, ground: 5, asteroid: 2 },
    objective: { kind: "simple", score: "wealth" },
    firstStationBuilding: "Coriolis",
    allowCriminal: true,
    alreadyPresent: {},
    ...overrides,
  };
}

describe("solveInWorker", () => {
  it("falls back to calling solve() directly when Worker isn't available (this test environment, matching real jsdom component tests)", async () => {
    expect(typeof Worker).toBe("undefined");
    const input = baseInput();
    const [direct, viaWrapper] = await Promise.all([solve(input), solveInWorker(input)]);
    expect(viaWrapper).toEqual(direct);
  }, 20000);

  describe("with a mocked Worker", () => {
    const originalWorker = globalThis.Worker;

    afterEach(() => {
      if (originalWorker === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any).Worker;
      } else {
        globalThis.Worker = originalWorker;
      }
    });

    it("resolves with the worker's reported result on a successful message", async () => {
      const fakeResult = { status: "optimal" } as unknown as SolverResult;
      class FakeWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage(): void {
          queueMicrotask(() => this.onmessage?.({ data: { ok: true, result: fakeResult } } as MessageEvent));
        }
        terminate(): void {}
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      globalThis.Worker = FakeWorker as any;

      const result = await solveInWorker(baseInput());
      expect(result).toBe(fakeResult);
    });

    it("rejects when the worker reports an error", async () => {
      class FakeWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage(): void {
          queueMicrotask(() => this.onmessage?.({ data: { ok: false, message: "boom" } } as MessageEvent));
        }
        terminate(): void {}
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      globalThis.Worker = FakeWorker as any;

      await expect(solveInWorker(baseInput())).rejects.toThrow("boom");
    });

    it("rejects when the worker itself errors (e.g. failed to load)", async () => {
      class FakeWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: ErrorEvent) => void) | null = null;
        postMessage(): void {
          queueMicrotask(() => this.onerror?.({ message: "worker failed to start" } as ErrorEvent));
        }
        terminate(): void {}
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      globalThis.Worker = FakeWorker as any;

      await expect(solveInWorker(baseInput())).rejects.toThrow("worker failed to start");
    });
  });
});
