/** Fixture logic: pure, so it satisfies the purity rule of the contract. */
export function count(text: string): number {
  return text.trim().split(/s+/).filter(Boolean).length;
}
