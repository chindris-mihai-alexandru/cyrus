/**
 * OpenCode Runner
 *
 * Implements IAgentRunner interface for OpenCode, enabling use of OpenCode
 * (with Groq, Gemini, Bedrock, or any configured provider) as the backend
 * for Cyrus Linear Agent.
 *
 * This runner can operate in two modes:
 * 1. Server mode (recommended): Uses the OpenCode SDK to communicate with
 *    an OpenCode server instance, enabling full streaming and event support.
 * 2. CLI mode: Spawns opencode with -p flag for simpler one-shot prompts.
 *
 * @example
 * ```typescript
 * const runner = new OpenCodeRunner({
 *   cyrusHome: '/home/user/.cyrus',
 *   workingDirectory: '/path/to/repo',
 *   model: 'groq/llama-3.3-70b-versatile',
 *   useServerMode: true,
 * });
 *
 * runner.on('message', (msg) => console.log(msg));
 * await runner.start("Fix the bug in auth.ts");
 * ```
 */

import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import type { createInterface } from "node:readline";
import type {
	IAgentRunner,
	IMessageFormatter,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
} from "cyrus-core";
import { OpenCodeMessageFormatter } from "./formatter.js";
import type {
	OpenCodeRunnerConfig,
	OpenCodeRunnerEvents,
	OpenCodeSessionInfo,
} from "./types.js";

export declare interface OpenCodeRunner {
	on<K extends keyof OpenCodeRunnerEvents>(
		event: K,
		listener: OpenCodeRunnerEvents[K],
	): this;
	emit<K extends keyof OpenCodeRunnerEvents>(
		event: K,
		...args: Parameters<OpenCodeRunnerEvents[K]>
	): boolean;
}

/**
 * OpenCode Runner - enables OpenCode as a Cyrus Linear Agent backend
 *
 * Supports multiple LLM providers through OpenCode's configuration:
 * - Groq (free tier available)
 * - Gemini (free tier available)
 * - AWS Bedrock
 * - OpenAI
 * - Anthropic
 * - And more via OpenCode's provider system
 */
export class OpenCodeRunner extends EventEmitter implements IAgentRunner {
	/**
	 * OpenCodeRunner supports streaming input via startStreaming(), addStreamMessage(), and completeStream()
	 * when using server mode. CLI mode does not support streaming.
	 */
	readonly supportsStreamingInput: boolean;

	private config: OpenCodeRunnerConfig;
	private process: ChildProcess | null = null;
	private sessionInfo: OpenCodeSessionInfo | null = null;
	private logStream: WriteStream | null = null;
	private readableLogStream: WriteStream | null = null;
	private messages: SDKMessage[] = [];
	private cyrusHome: string;
	private formatter: IMessageFormatter;
	private pendingResultMessage: SDKMessage | null = null;
	private readlineInterface: ReturnType<typeof createInterface> | null = null;
	private abortController: AbortController | null = null;

	// SDK client for server mode (placeholder for future implementation)
	private serverCleanup: (() => void) | null = null;

	constructor(config: OpenCodeRunnerConfig) {
		super();
		this.config = config;
		this.cyrusHome = config.cyrusHome;
		this.formatter = new OpenCodeMessageFormatter();
		// Only support streaming in server mode
		this.supportsStreamingInput = config.useServerMode ?? false;

		// Forward config callbacks to events
		if (config.onMessage) this.on("message", config.onMessage);
		if (config.onError) this.on("error", config.onError);
		if (config.onComplete) this.on("complete", config.onComplete);
	}

	/**
	 * Start a new OpenCode session with string prompt
	 */
	async start(prompt: string): Promise<OpenCodeSessionInfo> {
		return this.startWithPrompt(prompt);
	}

	/**
	 * Start a new OpenCode session with streaming input (server mode only)
	 */
	async startStreaming(initialPrompt?: string): Promise<OpenCodeSessionInfo> {
		if (!this.config.useServerMode) {
			throw new Error(
				"Streaming input is only supported in server mode. Set useServerMode: true",
			);
		}
		return this.startWithPrompt(null, initialPrompt);
	}

	/**
	 * Add a message to the streaming session (server mode only)
	 */
	addStreamMessage(content: string): void {
		if (!this.config.useServerMode) {
			throw new Error("addStreamMessage is only supported in server mode");
		}
		// TODO: Implement via SDK session.prompt with noReply option
		console.log(
			`[OpenCodeRunner] addStreamMessage: ${content.substring(0, 100)}...`,
		);
	}

	/**
	 * Complete the streaming session
	 */
	completeStream(): void {
		// In CLI mode, close stdin
		if (this.process?.stdin && !this.process.stdin.destroyed) {
			this.process.stdin.end();
		}
	}

	/**
	 * Internal method to start a session
	 */
	private async startWithPrompt(
		stringPrompt?: string | null,
		streamingInitialPrompt?: string,
	): Promise<OpenCodeSessionInfo> {
		if (this.isRunning()) {
			throw new Error("OpenCode session already running");
		}

		// Initialize session info
		this.sessionInfo = {
			sessionId: null,
			startedAt: new Date(),
			isRunning: true,
		};

		console.log(`[OpenCodeRunner] Starting new session`);
		console.log(
			"[OpenCodeRunner] Working directory:",
			this.config.workingDirectory,
		);
		console.log("[OpenCodeRunner] Model:", this.config.model || "(default)");

		// Ensure working directory exists
		if (this.config.workingDirectory) {
			try {
				mkdirSync(this.config.workingDirectory, { recursive: true });
			} catch (err) {
				console.error(
					"[OpenCodeRunner] Failed to create working directory:",
					err,
				);
			}
		}

		// Set up logging
		this.setupLogging();

		// Reset messages array
		this.messages = [];

		// Create abort controller
		this.abortController = new AbortController();

		try {
			// Use CLI mode (spawn opencode process)
			await this.runCLIMode(stringPrompt || streamingInitialPrompt || "");

			// Session completed successfully
			console.log(
				`[OpenCodeRunner] Session completed with ${this.messages.length} messages`,
			);
			this.sessionInfo.isRunning = false;

			// Emit deferred result message
			if (this.pendingResultMessage) {
				this.emitMessage(this.pendingResultMessage);
				this.pendingResultMessage = null;
			}

			this.emit("complete", this.messages);
		} catch (error) {
			console.error("[OpenCodeRunner] Session error:", error);

			if (this.sessionInfo) {
				this.sessionInfo.isRunning = false;
			}

			// Emit error result message
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			const errorResult: SDKResultMessage = {
				type: "result",
				subtype: "error_during_execution",
				duration_ms: Date.now() - this.sessionInfo!.startedAt.getTime(),
				duration_api_ms: 0,
				is_error: true,
				num_turns: 0,
				errors: [errorMessage],
				total_cost_usd: 0,
				usage: {
					input_tokens: 0,
					output_tokens: 0,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
					cache_creation: {
						ephemeral_1h_input_tokens: 0,
						ephemeral_5m_input_tokens: 0,
					},
					server_tool_use: {
						web_fetch_requests: 0,
						web_search_requests: 0,
					},
					service_tier: "standard",
				},
				modelUsage: {},
				permission_denials: [],
				uuid: crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
				session_id: this.sessionInfo?.sessionId || "pending",
			};

			this.emitMessage(errorResult);

			this.emit(
				"error",
				error instanceof Error ? error : new Error(String(error)),
			);
		} finally {
			// Clean up
			this.process = null;
			this.pendingResultMessage = null;
			this.abortController = null;

			// Close log streams
			if (this.logStream) {
				this.logStream.end();
				this.logStream = null;
			}
			if (this.readableLogStream) {
				this.readableLogStream.end();
				this.readableLogStream = null;
			}

			// Clean up server if in server mode
			if (this.serverCleanup) {
				this.serverCleanup();
				this.serverCleanup = null;
			}
		}

		return this.sessionInfo;
	}

	/**
	 * Run OpenCode in CLI mode (spawn process)
	 */
	private async runCLIMode(prompt: string): Promise<void> {
		const opencodePath = this.config.opencodePath || "opencode";
		const args: string[] = [];

		// Use 'run' subcommand with the prompt as positional argument
		args.push("run");

		// Add JSON output format for parsing (--format, not -f which is for files)
		args.push("--format", "json");

		// Add the prompt as the message argument
		args.push(prompt);

		// Note: Model selection happens via opencode.json config or /model command
		// We don't pass --model flag because opencode uses config-based model selection

		console.log(
			`[OpenCodeRunner] Spawning: ${opencodePath} run --format json "<prompt>"`,
		);

		this.process = spawn(opencodePath, args, {
			cwd: this.config.workingDirectory,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				// Pass config path if specified
				...(this.config.configPath && {
					OPENCODE_CONFIG: this.config.configPath,
				}),
			},
		});

		let stdoutData = "";
		let stderrData = "";

		// Collect stdout
		this.process.stdout?.on("data", (data: Buffer) => {
			const chunk = data.toString();
			stdoutData += chunk;
			// Always log stdout for debugging
			console.log("[OpenCodeRunner] stdout:", chunk.substring(0, 500));
		});

		// Collect stderr
		this.process.stderr?.on("data", (data: Buffer) => {
			const chunk = data.toString();
			stderrData += chunk;
			// Always log stderr for debugging
			console.error("[OpenCodeRunner] stderr:", chunk);
		});

		// Wait for process to complete
		await new Promise<void>((resolve, reject) => {
			if (!this.process) {
				reject(new Error("Process not started"));
				return;
			}

			this.process.on("close", (code: number) => {
				console.log(`[OpenCodeRunner] Process exited with code ${code}`);

				if (code === 0) {
					// Parse the JSON output and convert to SDK messages
					try {
						this.parseOpenCodeOutput(stdoutData);
						resolve();
					} catch (parseError) {
						reject(parseError);
					}
				} else {
					reject(
						new Error(
							`OpenCode exited with code ${code}: ${stderrData || "Unknown error"}`,
						),
					);
				}
			});

			this.process.on("error", (err: Error) => {
				console.error("[OpenCodeRunner] Process error:", err);
				reject(err);
			});
		});
	}

	/**
	 * Parse OpenCode NDJSON output and convert to SDK messages
	 *
	 * OpenCode with --format json outputs newline-delimited JSON (NDJSON),
	 * where each line is a separate JSON event with a "type" field.
	 *
	 * Actual OpenCode event types:
	 * - "step_start": Step begins, contains sessionID in event.sessionID
	 * - "text": Text from assistant in event.part.text
	 * - "tool_call": Tool being invoked
	 * - "tool_result": Result from tool
	 * - "step_finish": Step completed with stats in event.part.tokens
	 * - "error": Error occurred
	 */
	private parseOpenCodeOutput(output: string): void {
		// Generate a session ID upfront in case we don't get one from OpenCode
		if (!this.sessionInfo!.sessionId) {
			this.sessionInfo!.sessionId = `opencode-${Date.now()}`;
		}

		// Split output into lines and parse each as JSON
		const lines = output
			.trim()
			.split("\n")
			.filter((line) => line.trim());

		if (lines.length === 0) {
			console.warn("[OpenCodeRunner] Empty output from OpenCode");
			return;
		}

		console.log(`[OpenCodeRunner] Parsing ${lines.length} NDJSON lines`);

		// Accumulate text content from streaming events
		let accumulatedText = "";
		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		let totalCost = 0;

		for (const line of lines) {
			try {
				const event = JSON.parse(line) as Record<string, unknown>;
				const eventType = event.type as string;

				console.log(`[OpenCodeRunner] Event: ${eventType}`);

				switch (eventType) {
					case "step_start":
						// Step started - extract session ID from sessionID field
						if (event.sessionID) {
							this.sessionInfo!.sessionId = event.sessionID as string;
							this.sessionInfo!.opencodeSessionId = event.sessionID as string;
						}
						break;

					case "text": {
						// Text from assistant - extract from part.text
						const part = event.part as Record<string, unknown> | undefined;
						if (part?.text) {
							const text = part.text as string;
							accumulatedText += text;
							// Emit streaming text event
							this.emit("text", text);
						}
						break;
					}

					case "tool_call": {
						// Tool being called - extract tool name from part
						const part = event.part as Record<string, unknown> | undefined;
						const toolName = part?.name || part?.tool || "unknown";
						console.log(`[OpenCodeRunner] Tool call: ${toolName}`);
						break;
					}

					case "tool_result":
						// Tool result - log for debugging
						console.log(`[OpenCodeRunner] Tool result received`);
						break;

					case "step_finish": {
						// Step completed - extract stats from part.tokens and part.cost
						const part = event.part as Record<string, unknown> | undefined;
						if (part) {
							const tokens = part.tokens as Record<string, number> | undefined;
							if (tokens) {
								totalInputTokens += tokens.input || 0;
								totalOutputTokens += tokens.output || 0;
							}
							if (typeof part.cost === "number") {
								totalCost += part.cost;
							}
						}
						break;
					}

					case "error": {
						// Error occurred
						const part = event.part as Record<string, unknown> | undefined;
						const errorMsg = (part?.error ||
							part?.message ||
							event.error ||
							"Unknown error") as string;
						console.error(`[OpenCodeRunner] Error event: ${errorMsg}`);
						break;
					}

					default:
						// Unknown event type - log but continue
						console.log(`[OpenCodeRunner] Unknown event type: ${eventType}`);
				}
			} catch (parseError) {
				// Single line failed to parse - log and continue
				console.warn(
					`[OpenCodeRunner] Failed to parse line: ${line.substring(0, 100)}...`,
					parseError,
				);
			}
		}

		// If we accumulated text, emit an assistant message
		if (accumulatedText) {
			const assistantMessage: SDKAssistantMessage = {
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: accumulatedText }],
				},
				session_id: this.sessionInfo!.sessionId!,
			} as SDKAssistantMessage;

			this.emitMessage(assistantMessage);
			this.emit("assistant", accumulatedText);
		}

		// Create result message using accumulated stats
		const resultMessage: SDKResultMessage = {
			type: "result",
			subtype: "success",
			duration_ms: Date.now() - this.sessionInfo!.startedAt.getTime(),
			duration_api_ms: 0,
			is_error: false,
			num_turns: 1,
			result: accumulatedText || "",
			total_cost_usd: totalCost,
			usage: {
				input_tokens: totalInputTokens,
				output_tokens: totalOutputTokens,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				cache_creation: {
					ephemeral_1h_input_tokens: 0,
					ephemeral_5m_input_tokens: 0,
				},
				server_tool_use: {
					web_fetch_requests: 0,
					web_search_requests: 0,
				},
				service_tier: "standard",
			},
			modelUsage: {},
			permission_denials: [],
			uuid: crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
			session_id: this.sessionInfo!.sessionId!,
		};

		this.pendingResultMessage = resultMessage;
	}

	/**
	 * Stop the current session
	 */
	stop(): void {
		// Close readline interface
		if (this.readlineInterface) {
			if (typeof this.readlineInterface.close === "function") {
				this.readlineInterface.close();
			}
			this.readlineInterface.removeAllListeners();
			this.readlineInterface = null;
		}

		// Abort controller for SDK operations
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}

		// Kill process if running
		if (this.process) {
			console.log("[OpenCodeRunner] Stopping OpenCode process");
			this.process.kill("SIGTERM");
			this.process = null;
		}

		if (this.sessionInfo) {
			this.sessionInfo.isRunning = false;
		}

		// Clean up server
		if (this.serverCleanup) {
			this.serverCleanup();
			this.serverCleanup = null;
		}
	}

	/**
	 * Check if session is running
	 */
	isRunning(): boolean {
		return this.sessionInfo?.isRunning ?? false;
	}

	/**
	 * Get all messages from the session
	 */
	getMessages(): SDKMessage[] {
		return [...this.messages];
	}

	/**
	 * Get the message formatter
	 */
	getFormatter(): IMessageFormatter {
		return this.formatter;
	}

	/**
	 * Emit a message (add to array, log, and emit event)
	 */
	private emitMessage(message: SDKMessage): void {
		this.messages.push(message);

		// Log to JSON log
		if (this.logStream) {
			const logEntry = {
				type: "sdk-message",
				message,
				timestamp: new Date().toISOString(),
			};
			this.logStream.write(`${JSON.stringify(logEntry)}\n`);
		}

		// Log to readable log
		if (this.readableLogStream) {
			this.writeReadableLogEntry(message);
		}

		// Emit event
		this.emit("message", message);
	}

	/**
	 * Set up logging
	 */
	private setupLogging(): void {
		const logsDir = join(this.cyrusHome, "logs");
		const workspaceName =
			this.config.workspaceName ||
			(this.config.workingDirectory
				? this.config.workingDirectory.split("/").pop()
				: "default") ||
			"default";
		const workspaceLogsDir = join(logsDir, workspaceName);
		const sessionId = this.sessionInfo?.sessionId || "pending";

		// Close existing streams
		if (this.logStream) {
			this.logStream.end();
		}
		if (this.readableLogStream) {
			this.readableLogStream.end();
		}

		// Create logs directory
		mkdirSync(workspaceLogsDir, { recursive: true });

		// Create log streams
		const logPath = join(workspaceLogsDir, `${sessionId}.ndjson`);
		const readableLogPath = join(workspaceLogsDir, `${sessionId}.log`);

		console.log(`[OpenCodeRunner] Logging to: ${logPath}`);

		this.logStream = createWriteStream(logPath, { flags: "a" });
		this.readableLogStream = createWriteStream(readableLogPath, { flags: "a" });

		// Log session start
		const startEntry = {
			type: "session-start",
			sessionId,
			timestamp: new Date().toISOString(),
			config: {
				model: this.config.model,
				workingDirectory: this.config.workingDirectory,
				useServerMode: this.config.useServerMode,
			},
		};
		this.logStream.write(`${JSON.stringify(startEntry)}\n`);
		this.readableLogStream.write(
			`=== OpenCode Session ${sessionId} started at ${new Date().toISOString()} ===\n\n`,
		);
	}

	/**
	 * Write a readable log entry
	 */
	private writeReadableLogEntry(message: SDKMessage): void {
		if (!this.readableLogStream) return;

		const timestamp = new Date().toISOString();
		this.readableLogStream.write(`[${timestamp}] ${message.type}\n`);

		if (message.type === "user" || message.type === "assistant") {
			const content =
				typeof message.message.content === "string"
					? message.message.content
					: JSON.stringify(message.message.content, null, 2);
			this.readableLogStream.write(`${content}\n\n`);
		} else {
			this.readableLogStream.write(`${JSON.stringify(message, null, 2)}\n\n`);
		}
	}
}
