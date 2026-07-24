import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          part: {
            type: "string",
            enum: ["upperbody", "wholebody_up", "lowerbody", "accessories_up", "shoes"],
          },
          color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          secondaryColor: {
            anyOf: [
              { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
              { type: "null" },
            ],
          },
          tags: {
            type: "array",
            items: { type: "string" },
            maxItems: 4,
          },
          boundingBox: {
            type: "object",
            additionalProperties: false,
            properties: {
              x: { type: "integer", minimum: 0, maximum: 999 },
              y: { type: "integer", minimum: 0, maximum: 999 },
              width: { type: "integer", minimum: 1, maximum: 1000 },
              height: { type: "integer", minimum: 1, maximum: 1000 },
            },
            required: ["x", "y", "width", "height"],
          },
        },
        required: ["name", "part", "color", "secondaryColor", "tags", "boundingBox"],
      },
    },
  },
  required: ["items"],
};

const ANALYSIS_PROMPT = `Inspect the attached wardrobe photo and identify every distinct wearable clothing item visible.

Return one record per actual physical item that should enter a wardrobe. Ignore the person's body and non-wearable background objects. A photo may show one isolated garment or a person wearing several items.

For each item:
- include a tight bounding box around only that item using integer coordinates normalized to a 1000 by 1000 image
- x and y are the top-left corner, followed by width and height
- boxes may overlap when garments overlap, but each box must focus on one distinct item
- use only these category ids: upperbody, wholebody_up, lowerbody, accessories_up, shoes
- suggest a concise specific name, primary hex color, optional genuinely distinct secondary hex color, and 1-4 useful lowercase detail tags

Return only the JSON value required by the supplied output schema. Do not run shell commands, edit files, or use any tool other than inspecting the attached image.`;

function cleanErrorOutput(value = "") {
  const lines = String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("WARNING:"))
    .filter((line) => !line.match(/^\d{4}-\d\d-\d\dT.*\b(WARN|ERROR)\b/));
  return lines.slice(-8).join("\n").slice(0, 1600);
}

function codexEnvironment() {
  const env = { ...process.env };
  // The local provider must use the user's Codex login, never an ambient API key.
  delete env.OPENAI_API_KEY;
  return env;
}

export function runProcess(command, args, options = {}) {
  const {
    cwd,
    input,
    timeoutMs = 120_000,
    maxOutputBytes = 2 * 1024 * 1024,
  } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: codexEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputSize = 0;
    let settled = false;
    let forceKillTimer;
    let timeout;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      if (error) reject(error);
      else resolve(value);
    };
    const terminate = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      forceKillTimer.unref?.();
      reject(error);
    };
    const append = (kind, chunk) => {
      outputSize += chunk.length;
      if (outputSize > maxOutputBytes) {
        return terminate(new Error("Codex produced too much diagnostic output"));
      }
      if (kind === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => finish(error));
    child.on("close", (code, signal) => {
      clearTimeout(forceKillTimer);
      if (code === 0) return finish(null, { stdout, stderr });
      const detail = cleanErrorOutput(`${stderr}\n${stdout}`);
      const suffix = detail ? `: ${detail}` : signal ? ` (${signal})` : "";
      return finish(new Error(`Codex exited with status ${code ?? "unknown"}${suffix}`));
    });

    timeout = setTimeout(
      () => terminate(new Error(`Codex timed out after ${Math.round(timeoutMs / 1000)} seconds`)),
      timeoutMs,
    );

    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function inspectCodex({ bin = "codex", timeoutMs = 8_000 } = {}) {
  try {
    const versionResult = await runProcess(bin, ["--version"], { timeoutMs, maxOutputBytes: 128 * 1024 });
    const version = `${versionResult.stdout}\n${versionResult.stderr}`.match(/codex(?:-cli)?\s+v?([0-9][^\s]*)/i)?.[1] || null;
    const loginResult = await runProcess(bin, ["login", "status"], { timeoutMs, maxOutputBytes: 128 * 1024 });
    const loginText = `${loginResult.stdout}\n${loginResult.stderr}`;
    const authenticated = /logged in using/i.test(loginText);
    const authMode = loginText.match(/logged in using\s+([^\r\n]+)/i)?.[1]?.trim() || null;
    return {
      available: true,
      authenticated,
      version,
      authMode,
      error: authenticated ? null : "Codex is installed but not signed in",
    };
  } catch (error) {
    return {
      available: false,
      authenticated: false,
      version: null,
      authMode: null,
      error: error.code === "ENOENT" ? "Codex CLI is not installed" : cleanErrorOutput(error.message) || "Codex CLI is unavailable",
    };
  }
}

export function selectImportProvider({ preference = "auto", codexStatus, hasApiKey }) {
  const requested = String(preference || "auto").trim().toLowerCase();
  const normalized = requested === "openai" ? "api" : requested;
  if (!["auto", "codex", "api"].includes(normalized)) {
    return {
      provider: null,
      ready: false,
      error: `WARDROBE_IMPORT_PROVIDER must be auto, codex, or api (received ${requested})`,
    };
  }

  if (normalized === "codex") {
    return codexStatus?.available && codexStatus?.authenticated
      ? { provider: "codex", ready: true, fallback: null, error: null }
      : { provider: "codex", ready: false, fallback: null, error: codexStatus?.error || "Codex is not signed in" };
  }
  if (normalized === "api") {
    return hasApiKey
      ? { provider: "api", ready: true, fallback: null, error: null }
      : { provider: "api", ready: false, fallback: null, error: "OPENAI_API_KEY is not configured" };
  }
  if (codexStatus?.available && codexStatus?.authenticated) {
    return { provider: "codex", ready: true, fallback: hasApiKey ? "api" : null, error: null };
  }
  if (hasApiKey) {
    return { provider: "api", ready: true, fallback: null, error: null };
  }
  return {
    provider: null,
    ready: false,
    fallback: null,
    error: codexStatus?.error || "Sign in to Codex or configure OPENAI_API_KEY",
  };
}

function baseExecArgs({ cwd, sandbox, outputFile, schemaFile, images = [], model }) {
  const args = [
    "exec",
    "--ephemeral",
    "--sandbox",
    sandbox,
    "--ignore-rules",
    "--skip-git-repo-check",
    "-C",
    cwd,
  ];
  if (model) args.push("--model", model);
  if (images.length) args.push("--image", ...images);
  if (schemaFile) args.push("--output-schema", schemaFile);
  args.push("--output-last-message", outputFile, "-");
  return args;
}

export async function codexAnalyze({
  bin = "codex",
  image,
  model,
  timeoutMs = 120_000,
} = {}) {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "wardrobe-codex-analysis-"));
  try {
    const imagePath = path.join(workdir, "wardrobe-photo.png");
    const schemaPath = path.join(workdir, "analysis-schema.json");
    const outputPath = path.join(workdir, "analysis.json");
    await Promise.all([
      writeFile(imagePath, image),
      writeFile(schemaPath, `${JSON.stringify(ANALYSIS_SCHEMA)}\n`),
    ]);
    await runProcess(
      bin,
      baseExecArgs({
        cwd: workdir,
        sandbox: "read-only",
        outputFile: outputPath,
        schemaFile: schemaPath,
        images: [imagePath],
        model,
      }),
      { cwd: workdir, input: ANALYSIS_PROMPT, timeoutMs },
    );
    const parsed = JSON.parse(await readFile(outputPath, "utf8"));
    if (!Array.isArray(parsed.items)) throw new Error("Codex returned an invalid clothing list");
    return parsed.items;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Codex returned invalid structured clothing data");
    throw error;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function codexGenerateImage({
  bin = "codex",
  images,
  prompt,
  outputPath,
  workdir,
  model,
  timeoutMs = 300_000,
} = {}) {
  const resolvedWorkdir = path.resolve(workdir);
  const resolvedOutput = path.resolve(outputPath);
  if (path.dirname(resolvedOutput) !== resolvedWorkdir) {
    throw new Error("Codex output must stay inside the import job directory");
  }
  const finalMessagePath = path.join(resolvedWorkdir, `.codex-${path.basename(resolvedOutput)}.txt`);
  const imageList = images.map((imagePath) => path.resolve(imagePath));
  const generationPrompt = `${prompt}

Execution requirements:
- Use the native built-in image generation tool. Do not use an API-key CLI, SVG, HTML, Canvas, Python drawing, or any other fake/programmatic substitute.
- The attached images are the authoritative visual references, in the order described above.
- Save the selected generated PNG to exactly: ${resolvedOutput}
- Do not overwrite or modify any reference image.
- Do not modify files outside this import job directory.
- If native image generation is unavailable, do not fabricate an output; reply exactly IMAGE_GENERATION_UNAVAILABLE.`;

  try {
    await rm(resolvedOutput, { force: true });
    await runProcess(
      bin,
      baseExecArgs({
        cwd: resolvedWorkdir,
        sandbox: "workspace-write",
        outputFile: finalMessagePath,
        images: imageList,
        model,
      }),
      { cwd: resolvedWorkdir, input: generationPrompt, timeoutMs },
    );
    await stat(resolvedOutput);
    return await readFile(resolvedOutput);
  } catch (error) {
    let finalMessage = "";
    try { finalMessage = await readFile(finalMessagePath, "utf8"); } catch {}
    if (/IMAGE_GENERATION_UNAVAILABLE/i.test(finalMessage) || error.code === "ENOENT") {
      throw new Error("The signed-in Codex session can inspect photos, but native image generation is unavailable. Enable the built-in Image Generation capability or use the optional API-key provider.");
    }
    throw error;
  } finally {
    await rm(finalMessagePath, { force: true });
  }
}
