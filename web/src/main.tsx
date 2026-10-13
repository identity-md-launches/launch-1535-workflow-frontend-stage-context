import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { loadConfig, type AppConfig } from "./config";
import { AppContext } from "./context";
import { App } from "./App";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Root() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConfig().then(setConfig, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <main className="shell" style={{ paddingBlock: 48 }}>
        <div className="status error" role="alert">
          <strong>Unable to load the deployment configuration.</strong>
          <span>{error}</span>
          <span>Reload the page. If it keeps failing, the site files were not published completely.</span>
        </div>
      </main>
    );
  }
  if (!config) {
    return (
      <main className="shell" style={{ paddingBlock: 48 }}>
        <p className="muted" role="status">
          Loading deployment configuration…
        </p>
      </main>
    );
  }
  return (
    <AppContext.Provider value={config}>
      <WagmiProvider config={config.wagmi}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </AppContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
