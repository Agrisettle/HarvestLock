import { performance } from "node:perf_hooks";
import { Keypair } from "@stellar/stellar-sdk";

const baseUrl = new URL(process.env.API_BASE_URL ?? "http://127.0.0.1:3000");
const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);
if (!allowedHosts.has(baseUrl.hostname) && process.env.LOAD_TEST_ALLOW_REMOTE !== "1") {
  throw new Error("Refusing to load test a remote host; set LOAD_TEST_ALLOW_REMOTE=1 to override");
}

const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? 10);
const durationSeconds = Number(process.env.LOAD_TEST_DURATION_SECONDS ?? 15);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 500) {
  throw new Error("LOAD_TEST_CONCURRENCY must be an integer between 1 and 500");
}
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 300) {
  throw new Error("LOAD_TEST_DURATION_SECONDS must be greater than 0 and at most 300");
}

const address = Keypair.random().publicKey();
const path = (process.env.LOAD_TEST_PATH ?? "/parties/{address}/standing").replace("{address}", address);
const target = new URL(path, baseUrl);
const endAt = performance.now() + durationSeconds * 1000;
const latencies: number[] = [];
const statuses = new Map<number, number>();
let networkErrors = 0;

async function worker(): Promise<void> {
  while (performance.now() < endAt) {
    const startedAt = performance.now();
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(10_000) });
      await response.arrayBuffer();
      latencies.push(performance.now() - startedAt);
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
    } catch {
      latencies.push(performance.now() - startedAt);
      networkErrors += 1;
    }
  }
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const elapsedSeconds = (performance.now() - startedAt) / 1000;
latencies.sort((left, right) => left - right);
const percentile = (fraction: number): number =>
  latencies.length === 0 ? 0 : latencies[Math.min(Math.ceil(latencies.length * fraction) - 1, latencies.length - 1)]!;
const successful = [...statuses.entries()].reduce((total, [status, count]) => total + (status >= 200 && status < 300 ? count : 0), 0);
const requests = latencies.length;

console.log(
  JSON.stringify(
    {
      target: `${target.origin}${target.pathname}`,
      concurrency,
      configuredDurationSeconds: durationSeconds,
      actualDurationSeconds: Number(elapsedSeconds.toFixed(2)),
      requests,
      requestsPerSecond: Number((requests / elapsedSeconds).toFixed(2)),
      successful,
      non2xx: requests - successful - networkErrors,
      networkErrors,
      statuses: Object.fromEntries([...statuses.entries()].sort(([left], [right]) => left - right)),
      latencyMs: {
        p50: Number(percentile(0.5).toFixed(2)),
        p95: Number(percentile(0.95).toFixed(2)),
        max: Number((latencies.at(-1) ?? 0).toFixed(2)),
      },
    },
    null,
    2,
  ),
);