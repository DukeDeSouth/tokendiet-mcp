/** Raw rg baseline below this BPE size is returned unchanged (Sprint 3.2 A2). */
export const SEARCH_PASSTHROUGH_TOKEN_THRESHOLD = 300;

export function shouldPassthroughSearchBaseline(tokensIn: number): boolean {
  return tokensIn < SEARCH_PASSTHROUGH_TOKEN_THRESHOLD;
}
