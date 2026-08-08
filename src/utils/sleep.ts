// Promise-based setTimeout wrapper. Extracted from the two places that
// duplicated it (runWithBackoff for OpenAI 429s, LiveWeatherRepository
// for OWM 429/5xx retries). Any code that needs "wait N ms before
// continuing" inside an async function should import this rather than
// re-declare the two-line helper.
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
