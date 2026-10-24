/** Tab-lifetime preferences only. Durable wager records use the authenticated API. */
const values = new Map<string, string>();
export const transientStore = {
  getItem(key: string): string | null { return values.get(key) ?? null; },
  setItem(key: string, value: string): void { values.set(key, value); },
};
