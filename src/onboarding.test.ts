import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "./config/defaults.js";
import {
  applyProviderPreset,
  finishOnboardingSummary,
  getOnboardingReadiness,
  getServerOnboardingReadiness,
  serverOnboardingSummary,
  setProviderBaseUrl
} from "./onboarding.js";

test("applyProviderPreset switches to OpenRouter defaults when the model still matches the old preset", () => {
  const nextConfig = applyProviderPreset(defaultConfig, "openrouter");

  assert.equal(nextConfig.providers.preset, "openrouter");
  assert.equal(nextConfig.providers.label, "OpenRouter");
  assert.equal(nextConfig.providers.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(nextConfig.providers.model, "openai/gpt-4.1");
});

test("applyProviderPreset preserves a custom model override across preset changes", () => {
  const nextConfig = applyProviderPreset(
    {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        model: "gpt-4.1-mini"
      }
    },
    "openrouter"
  );

  assert.equal(nextConfig.providers.model, "gpt-4.1-mini");
});

test("setProviderBaseUrl switches preset to custom when editing a preset-managed base URL", () => {
  const nextConfig = setProviderBaseUrl(defaultConfig, "https://gateway.example.com/v1");

  assert.equal(nextConfig.providers.preset, "custom");
  assert.equal(nextConfig.providers.label, "Custom");
  assert.equal(nextConfig.providers.baseUrl, "https://gateway.example.com/v1");
});

test("local server onboarding is ready even before the local key exists", () => {
  const readiness = getServerOnboardingReadiness({
    mode: "local",
    serverUrl: "ws://127.0.0.1:4317",
    authKey: "",
    localServerKeyFound: false
  });

  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.missing, []);
  assert.deepEqual(readiness.notes, ["local server key not found yet"]);
  assert.equal(
    serverOnboardingSummary({
      mode: "local",
      serverUrl: "ws://127.0.0.1:4317",
      authKey: "",
      localServerKeyFound: false
    }),
    "local / default host"
  );
});

test("remote server onboarding requires both the URL and auth key", () => {
  const readiness = getServerOnboardingReadiness({
    mode: "remote",
    serverUrl: "",
    authKey: "",
    localServerKeyFound: false
  });

  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missing, ["remote server URL", "remote auth key"]);
  assert.equal(
    serverOnboardingSummary({
      mode: "remote",
      serverUrl: "",
      authKey: "",
      localServerKeyFound: false
    }),
    "remote / setup incomplete"
  );
});

test("getOnboardingReadiness reports required and recommended fields separately", () => {
  const readiness = getOnboardingReadiness({
    ...defaultConfig,
    providers: {
      ...defaultConfig.providers,
      apiKey: ""
    },
    personalization: {
      ...defaultConfig.personalization,
      userName: ""
    }
  });

  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missing, ["API key"]);
  assert.deepEqual(readiness.recommended, ["your name"]);
});

test("finishOnboardingSummary marks a fully configured draft as ready", () => {
  const summary = finishOnboardingSummary({
    ...defaultConfig,
    providers: {
      ...defaultConfig.providers,
      apiKey: "secret"
    },
    personalization: {
      ...defaultConfig.personalization,
      userName: "Owen"
    }
  });

  assert.equal(summary, "ready to save");
});
