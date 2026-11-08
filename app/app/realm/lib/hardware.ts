export function isLowEndDevice(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  // SavePal: only genuinely weak devices (2 cores or 2 GB) drop the ambient life; a typical phone keeps it.
  return navigator.hardwareConcurrency <= 2 || (navigator as any).deviceMemory <= 2;
}
