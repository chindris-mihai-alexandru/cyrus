/**
 * OpenCode Runner Package
 *
 * Provides OpenCode as an agent backend for Cyrus Linear Agent.
 * Enables using Groq, Gemini, or any OpenCode-supported provider
 * as an alternative to Claude Code.
 *
 * @example
 * ```typescript
 * import { OpenCodeRunner } from "cyrus-opencode-runner";
 *
 * const runner = new OpenCodeRunner({
 *   cyrusHome: "/home/user/.cyrus",
 *   workingDirectory: "/path/to/repo",
 *   model: "groq/llama-3.3-70b-versatile",
 * });
 *
 * runner.on("message", (msg) => console.log(msg));
 * await runner.start("Fix the bug in auth.ts");
 * ```
 */

export { OpenCodeMessageFormatter } from "./formatter.js";
export { OpenCodeRunner } from "./OpenCodeRunner.js";
export { SimpleOpenCodeRunner } from "./SimpleOpenCodeRunner.js";
export type {
	OpenCodeMessagePart,
	OpenCodeRunnerConfig,
	OpenCodeRunnerEvents,
	OpenCodeSDKEvent,
	OpenCodeSessionInfo,
} from "./types.js";
