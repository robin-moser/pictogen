import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import {
  ApiError,
  getAuthConfig,
  getIdentity,
  logout,
  type AuthConfig,
  type Identity,
} from "./api.js";
import { App } from "./app.js";
import { AuthScreen } from "./components/AuthScreen.js";
import { ChangePasswordScreen } from "./components/ChangePasswordScreen.js";
import "./styles.css";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("Application root not found.");
}

function Root() {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadIdentity = useCallback(async () => {
    setIdentity(await getIdentity());
  }, []);

  const authenticationRequired = useCallback(() => {
    if (config?.mode === "local") {
      setIdentity(null);
    } else {
      setError("Authentication through the configured proxy failed.");
    }
  }, [config?.mode]);

  const signOut = useCallback(() => {
    void logout()
      .catch(() => undefined)
      .finally(() => setIdentity(null));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getAuthConfig(controller.signal)
      .then(async (loadedConfig) => {
        setConfig(loadedConfig);
        try {
          setIdentity(await getIdentity(controller.signal));
        } catch (identityError) {
          if (
            loadedConfig.mode === "local" &&
            identityError instanceof ApiError &&
            identityError.status === 401
          ) {
            setIdentity(null);
          } else {
            throw identityError;
          }
        }
        setLoaded(true);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Pictogen could not be loaded.",
          );
          setLoaded(true);
        }
      });
    return () => controller.abort();
  }, []);

  if (error) {
    return (
      <main class="flex min-h-dvh items-center justify-center p-6">
        <div class="alert alert-error max-w-md">{error}</div>
      </main>
    );
  }
  if (!loaded || !config) {
    return (
      <main class="flex min-h-dvh items-center justify-center">
        <span class="loading loading-spinner loading-md" aria-label="Loading" />
      </main>
    );
  }
  if (!identity) {
    if (config.mode === "local") {
      return (
        <AuthScreen
          minimumLength={config.minimumPasswordLength}
          onAuthenticated={loadIdentity}
        />
      );
    }
    return (
      <main class="flex min-h-dvh items-center justify-center p-6">
        <div class="alert alert-error max-w-md">
          Authentication through the configured proxy failed.
        </div>
      </main>
    );
  }
  if (config.mode === "local" && identity.mustChangePassword) {
    return (
      <ChangePasswordScreen
        minimumLength={config.minimumPasswordLength}
        onChanged={loadIdentity}
      />
    );
  }
  return (
    <App
      identity={identity}
      authMode={config.mode}
      minimumPasswordLength={config.minimumPasswordLength}
      onAuthenticationRequired={authenticationRequired}
      onLogout={signOut}
      onPasswordChanged={loadIdentity}
      onIdentityChanged={loadIdentity}
    />
  );
}

render(<Root />, root);
