import assert from "node:assert/strict";
import test from "node:test";
import { runProcess, selectImportProvider } from "./codex-local-adapter.mjs";

const signedInCodex = {
  available: true,
  authenticated: true,
  version: "0.144.4",
  authMode: "ChatGPT",
  error: null,
};

test("auto prefers a signed-in Codex session over an API key", () => {
  assert.deepEqual(
    selectImportProvider({
      preference: "auto",
      codexStatus: signedInCodex,
      hasApiKey: true,
    }),
    { provider: "codex", ready: true, fallback: "api", error: null },
  );
});

test("auto selects the API provider only when Codex is unavailable", () => {
  assert.deepEqual(
    selectImportProvider({
      preference: "auto",
      codexStatus: {
        available: false,
        authenticated: false,
        error: "Codex CLI is not installed",
      },
      hasApiKey: true,
    }),
    { provider: "api", ready: true, fallback: null, error: null },
  );
});

test("an explicit Codex preference never falls through to an API key", () => {
  const selected = selectImportProvider({
    preference: "codex",
    codexStatus: {
      available: true,
      authenticated: false,
      error: "Codex is installed but not signed in",
    },
    hasApiKey: true,
  });
  assert.equal(selected.provider, "codex");
  assert.equal(selected.ready, false);
  assert.match(selected.error, /not signed in/i);
});

test("invalid provider preferences fail closed", () => {
  const selected = selectImportProvider({
    preference: "remote",
    codexStatus: signedInCodex,
    hasApiKey: true,
  });
  assert.equal(selected.ready, false);
  assert.match(selected.error, /auto, codex, or api/);
});

test("Codex child processes do not inherit OPENAI_API_KEY", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "must-not-reach-child";
  try {
    const result = await runProcess(
      process.execPath,
      ["-e", "process.stdout.write(process.env.OPENAI_API_KEY ? 'present' : 'missing')"],
      { timeoutMs: 5_000 },
    );
    assert.equal(result.stdout, "missing");
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
