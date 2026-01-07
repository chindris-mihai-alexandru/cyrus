/**
 * OpenCode Runner Types
 *
 * Configuration and event types for the OpenCode runner, which enables
 * using OpenCode (with Groq, Gemini, OpenRouter, or any configured provider)
 * as the backend for Cyrus Linear Agent.
 *
 * RECOMMENDED FREE MODELS FOR AGENTIC TASKS (Jan 2026):
 *
 * 1. OpenRouter (best free tier for coding):
 *    - "openrouter/xiaomi/mimo-v2-flash:free" - SWE-bench #1 open source model
 *    - "openrouter/mistralai/devstral-2512:free" - Agentic coding specialist
 *    - "openrouter/qwen/qwen3-coder:free" - 480B MoE code model
 *    Limits: 50 req/day (1000 with $10 lifetime topup)
 *
 * 2. Groq (fastest inference):
 *    - "groq/llama-3.3-70b-versatile" - 1000 req/day
 *
 * 3. Cerebras (fastest inference, good limits):
 *    - "cerebras/llama-3.3-70b" - 14,400 req/day
 *
 * Model selection happens via opencode.json, not CLI flags.
 * Set the model in ~/.config/opencode/opencode.json or pass configPath.
 */

import type {
	AgentRunnerConfig,
	AgentSessionInfo,
	SDKMessage,
} from "cyrus-core";

/**
 * OpenCode-specific configuration extending the base AgentRunnerConfig
 */
export interface OpenCodeRunnerConfig extends AgentRunnerConfig {
	/**
	 * Path to opencode executable (defaults to "opencode" in PATH)
	 */
	opencodePath?: string;

	/**
	 * OpenCode model to use.
	 *
	 * Recommended FREE models for agentic/coding tasks:
	 * - "openrouter/xiaomi/mimo-v2-flash:free" (best coding, SWE-bench #1)
	 * - "openrouter/mistralai/devstral-2512:free" (agentic coding)
	 * - "groq/llama-3.3-70b-versatile" (fast, 1000 req/day)
	 * - "cerebras/llama-3.3-70b" (fastest, 14,400 req/day)
	 *
	 * If not specified, uses the default from opencode.json
	 */
	model?: string;

	/**
	 * Whether to use the OpenCode SDK server mode (recommended)
	 * When true, starts an OpenCode server and uses the SDK to communicate
	 * When false, spawns opencode CLI directly with -p flag
	 * @default true
	 */
	useServerMode?: boolean;

	/**
	 * Port for the OpenCode server (only used in server mode)
	 * @default 4096
	 */
	serverPort?: number;

	/**
	 * Timeout in milliseconds for server startup
	 * @default 10000
	 */
	serverTimeout?: number;

	/**
	 * Path to opencode.json configuration file
	 * If not specified, uses the default discovery
	 */
	configPath?: string;

	/**
	 * Whether to enable debug output
	 */
	debug?: boolean;

	/**
	 * Additional system prompt to append (used by SimpleOpenCodeRunner
	 * to constrain responses to enumerated values)
	 */
	appendSystemPrompt?: string;
}

/**
 * Session info specific to OpenCode runner
 */
export interface OpenCodeSessionInfo extends AgentSessionInfo {
	/**
	 * The OpenCode session ID (from the SDK)
	 */
	opencodeSessionId?: string;

	/**
	 * Server URL if running in server mode
	 */
	serverUrl?: string;
}

/**
 * OpenCode runner events
 */
export interface OpenCodeRunnerEvents {
	message: (message: SDKMessage) => void;
	error: (error: Error) => void;
	complete: (messages: SDKMessage[]) => void;
	text: (text: string) => void;
	"tool-use": (toolName: string, toolInput: unknown) => void;
	assistant: (text: string) => void;
	/**
	 * Raw OpenCode SDK event
	 */
	opencodeEvent: (event: OpenCodeSDKEvent) => void;
}

/**
 * OpenCode SDK event structure (from event.subscribe())
 */
export interface OpenCodeSDKEvent {
	type: string;
	properties?: Record<string, unknown>;
}

/**
 * OpenCode message part types
 */
export interface OpenCodeMessagePart {
	type: "text" | "tool_use" | "tool_result";
	text?: string;
	toolName?: string;
	toolInput?: unknown;
	toolResult?: unknown;
}
