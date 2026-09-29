export type Theme = "light" | "dark" | "system";

export const themeCookieName = "theme";

export function parseTheme(value: string | undefined): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
