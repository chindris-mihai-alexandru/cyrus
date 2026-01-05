/**
 * OpenCode Runner Types
 *
 * Configuration and event types for the OpenCode runner, which enables
 * using OpenCode (with Groq, Gemini, or any configured provider) as the
 * backend for Cyrus Linear Agent.
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
	 * OpenCode model to use (e.g., "groq/llama-3.3-70b-versatile")
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
