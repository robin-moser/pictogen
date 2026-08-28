import { useEffect, useState } from "preact/hooks";

type ConnectionState = "checking" | "connected" | "unavailable";

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("checking");

  useEffect(() => {
    const controller = new AbortController();

    async function checkHealth() {
      try {
        const response = await fetch("/api/health", {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Health check failed.");
        }

        setConnection("connected");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setConnection("unavailable");
        }
      }
    }

    void checkHealth();

    return () => {
      controller.abort();
    };
  }, []);

  const status = {
    checking: "Checking workspace",
    connected: "Workspace connected",
    unavailable: "Server unavailable",
  }[connection];

  return (
    <div class="app-shell">
      <header class="masthead">
        <a class="wordmark" href="/" aria-label="Pictogen home">
          Pictogen
        </a>
        <div class={`system-status system-status--${connection}`} role="status">
          <span class="status-dot" aria-hidden="true" />
          {status}
        </div>
      </header>

      <div class="dashboard">
        <aside class="sessions" aria-labelledby="sessions-heading">
          <div class="panel-heading">
            <h2 id="sessions-heading">Sessions</h2>
          </div>
          <p class="empty-list">No sessions</p>
        </aside>

        <main class="workspace" aria-labelledby="workspace-heading">
          <header class="workspace-heading">
            <div>
              <p>Workspace</p>
              <h1 id="workspace-heading">Image generation</h1>
            </div>
          </header>

          <section class="empty-workspace">
            <div class="empty-frame" aria-hidden="true" />
            <h2>No session selected</h2>
            <p>Select a session to edit a prompt and view generated images.</p>
          </section>
        </main>
      </div>
    </div>
  );
}
