import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLiveStatus } from "./useLiveStatus";

const fetchMock = vi.fn();

function respond(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({ ok, json: async () => body });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useLiveStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VITE_API_URL", "http://api.test");
    setVisibility("visible");
    respond({ status: "Active" });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("does nothing when VITE_API_URL is unset", async () => {
    vi.stubEnv("VITE_API_URL", "");
    const { result } = renderHook(() => useLiveStatus("C1"));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("reads the status from the API", async () => {
    const { result } = renderHook(() => useLiveStatus("C/1"));
    await flush();
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/commitments/C%2F1");
    expect(result.current?.status).toBe("Active");
    expect(result.current?.isStale).toBe(false);
  });

  it("ignores non-ok responses and non-string statuses", async () => {
    respond({ status: "Active" }, false);
    const { result, unmount } = renderHook(() => useLiveStatus("C1"));
    await flush();
    expect(result.current).toBeNull();
    unmount();

    respond({ status: 5 });
    const second = renderHook(() => useLiveStatus("C1"));
    await flush();
    expect(second.result.current).toBeNull();
  });

  it("flips isStale after 5 minutes without a successful read", async () => {
    const { result } = renderHook(() => useLiveStatus("C1"));
    await flush();
    fetchMock.mockRejectedValue(new Error("down"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
    });
    expect(result.current?.isStale).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current?.status).toBe("Active");
    expect(result.current?.isStale).toBe(true);
  });

  it("polls every 60 s while visible", async () => {
    renderHook(() => useLiveStatus("C1"));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fetch while hidden, and fetches immediately when visible again", async () => {
    renderHook(() => useLiveStatus("C1"));
    await flush();
    fetchMock.mockClear();
    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    setVisibility("visible");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops polling on unmount", async () => {
    const { unmount } = renderHook(() => useLiveStatus("C1"));
    await flush();
    unmount();
    fetchMock.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    setVisibility("visible");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
