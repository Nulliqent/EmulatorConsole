import { useCallback, useEffect, useState } from "react";
import type { ServicesResponse } from "../shared/models";
import { sortByTitle } from "../shared/services";

// The Service Model index summary (436 services) is read once per page load and kept. The server sends it with an
// ETag, so a reload revalidates instead of downloading it again.

export type ServiceIndex = { emulatorVersion: string; services: ServicesResponse["services"] };

let pending: Promise<ServiceIndex> | null = null;
let loaded: ServiceIndex | null = null;

/** Starts reading the index (if it is not read) and returns it. A failed read is not kept, so it can be retried. */
export function loadServiceIndex(): Promise<ServiceIndex> {
  pending ??= fetch("/api/services")
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as ServicesResponse;
      loaded = { emulatorVersion: body.meta.emulator.version, services: sortByTitle(body.services) };
      return loaded;
    })
    .catch((e: unknown) => {
      pending = null;
      throw e;
    });
  return pending;
}

export type ServiceIndexState = { status: "loading" } | { status: "error" } | ({ status: "ready" } & ServiceIndex);

/** The index for a page: loading, ready, or error (with `retry`). Ready at once when it was read before. */
export function useServiceIndex(): ServiceIndexState & { retry: () => void } {
  const [state, setState] = useState<ServiceIndexState>(() => (loaded ? { status: "ready", ...loaded } : { status: "loading" }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadServiceIndex().then(
      (index) => live && setState({ status: "ready", ...index }),
      () => live && setState({ status: "error" }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, retry };
}

/**
 * Services with Calls in this run, most recent first, as slugs. The Calls log arrives with ticket #10; until then
 * nothing has been seen, so the Services page shows no "Seen this run" row. #10 replaces this body.
 */
export function useSeenServices(): string[] {
  return [];
}
