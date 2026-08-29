export function normalizeUsername(username: string): string {
  return username.trim().toLocaleLowerCase("en-US");
}
