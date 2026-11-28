import { useSyncExternalStore } from "react";
import { readLocal, writeLocal } from "./storage";

/**
 * The active Region is kept in this browser's localStorage under REGION_KEY (state A8: shared by tabs, the last
 * change wins). Anything that reads from the Emulator takes the Region from getRegion() or useRegion(), so
 * every later read uses the Developer's choice. The server keeps no Region.
 */
export const REGION_KEY = "console.region";
export const DEFAULT_REGION = "us-east-1";

// The commercial Regions. A saved value outside this list is still honoured if it looks like a Region.
export const REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "ca-central-1", "sa-east-1",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-north-1", "eu-south-1",
  "ap-south-1", "ap-northeast-1", "ap-northeast-2", "ap-southeast-1", "ap-southeast-2",
  "me-south-1", "af-south-1",
];

const LOOKS_LIKE_REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;

export function parseRegion(value: string | null): string {
  return value !== null && LOOKS_LIKE_REGION.test(value) ? value : DEFAULT_REGION;
}

const listeners = new Set<() => void>();
// A session-only copy, for when storage refuses writes. It wins over storage until another tab changes the choice.
let memory: string | null = null;

/** The active Region: what this page set, else what browser storage holds, else the default. */
export function getRegion(): string {
  return memory ?? parseRegion(readLocal(REGION_KEY));
}

/** Forgets the page's own copy, so the next read comes from storage. */
export function resetRegionMemory(): void {
  memory = null;
}

export function setRegion(region: string): void {
  if (!LOOKS_LIKE_REGION.test(region)) return;
  memory = region;
  writeLocal(REGION_KEY, region);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === REGION_KEY) {
      resetRegionMemory(); // another tab changed it; its value wins
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useRegion(): [string, (region: string) => void] {
  return [useSyncExternalStore(subscribe, getRegion, () => DEFAULT_REGION), setRegion];
}
