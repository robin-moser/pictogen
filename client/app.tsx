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
    checking: {
      label: "Checking workspace",
      indicator: "status-neutral",
      text: "text-base-content/60",
    },
    connected: {
      label: "Workspace connected",
      indicator: "status-success",
      text: "text-success",
    },
    unavailable: {
      label: "Server unavailable",
      indicator: "status-error",
      text: "text-error",
    },
  }[connection];

  return (
    <div class="bg-base-200 grid min-h-dvh grid-rows-[4rem_1fr]">
      <header class="navbar border-base-300 bg-base-100 border-b px-4 sm:px-6">
        <div class="navbar-start">
          <a
            class="link link-hover text-lg font-semibold"
            href="/"
            aria-label="Pictogen home"
          >
            Pictogen
          </a>
        </div>
        <div class="navbar-end">
          <div
            class={`flex items-center gap-2 text-xs font-medium ${status.text}`}
            role="status"
          >
            <span
              class={`status status-xs ${status.indicator}`}
              aria-hidden="true"
            />
            {status.label}
          </div>
        </div>
      </header>

      <div class="grid min-h-0 grid-rows-[auto_1fr] md:grid-cols-[16rem_minmax(0,1fr)] md:grid-rows-1">
        <aside
          class="border-base-300 bg-base-100 border-b p-4 md:border-r md:border-b-0"
          aria-labelledby="sessions-heading"
        >
          <h2 id="sessions-heading" class="px-2 py-1 text-sm font-semibold">
            Sessions
          </h2>
          <p class="text-base-content/60 border-base-300 mt-2 border-t px-2 py-4 text-sm">
            No sessions
          </p>
        </aside>

        <main
          class="bg-base-100 grid min-h-0 min-w-0 grid-rows-[auto_1fr]"
          aria-labelledby="workspace-heading"
        >
          <header class="border-base-300 flex min-h-20 items-center border-b px-5 py-4 sm:px-6">
            <div>
              <p class="text-base-content/60 text-xs font-medium uppercase">
                Workspace
              </p>
              <h1 id="workspace-heading" class="text-lg font-semibold">
                Image generation
              </h1>
            </div>
          </header>

          <section class="hero min-h-0 px-5 py-10">
            <div class="hero-content text-center">
              <div class="card card-border card-sm bg-base-100 max-w-md">
                <div class="card-body items-center">
                  <h2 class="card-title">No session selected</h2>
                  <p class="text-base-content/60">
                    Select a session to edit a prompt and view generated images.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
