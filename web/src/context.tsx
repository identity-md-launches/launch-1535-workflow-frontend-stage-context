import { createContext, useContext } from "react";
import type { AppConfig } from "./config";

export const AppContext = createContext<AppConfig | null>(null);

export function useApp(): AppConfig {
  const value = useContext(AppContext);
  if (!value) throw new Error("App configuration is not loaded");
  return value;
}
