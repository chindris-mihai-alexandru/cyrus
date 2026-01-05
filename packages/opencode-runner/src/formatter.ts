/**
 * OpenCode Message Formatter
 *
 * Formats tool messages for display in Linear or other issue trackers.
 * Follows the same pattern as ClaudeMessageFormatter and GeminiMessageFormatter.
 */

import type { IMessageFormatter } from "cyrus-core";

/**
 * Formatter for OpenCode-style messages
 *
 * OpenCode uses similar tool names to Claude Code, so the formatting
 * is largely compatible with ClaudeMessageFormatter.
 */
export class OpenCodeMessageFormatter implements IMessageFormatter {
	/**
	 * Format TodoWrite JSON content for display
	 */
	formatTodoWriteParameter(jsonContent: string): string {
		try {
			const parsed = JSON.parse(jsonContent);
			if (Array.isArray(parsed)) {
				return parsed
					.map((item: { content?: string; status?: string }) => {
						const status = item.status === "completed" ? "[x]" : "[ ]";
						return `${status} ${item.content || ""}`;
					})
					.join("\n");
			}
			return jsonContent;
		} catch {
			return jsonContent;
		}
	}

	/**
	 * Format a tool parameter for display
	 */
	formatToolParameter(toolName: string, toolInput: unknown): string {
		if (!toolInput || typeof toolInput !== "object") {
			return String(toolInput ?? "");
		}

		const input = toolInput as Record<string, unknown>;

		switch (toolName) {
			case "Read":
			case "read":
				return String(input.file_path || input.filePath || "");

			case "Edit":
			case "edit":
				return String(input.file_path || input.filePath || "");

			case "Write":
			case "write":
				return String(input.file_path || input.filePath || "");

			case "Bash":
			case "bash":
				return String(input.command || "");

			case "Glob":
			case "glob":
				return String(input.pattern || "");

			case "Grep":
			case "grep":
				return String(input.pattern || "");

			case "TodoWrite":
			case "todowrite":
				if (input.todos) {
					return this.formatTodoWriteParameter(JSON.stringify(input.todos));
				}
				return "";

			case "Task":
			case "task":
				return String(input.description || input.prompt || "").substring(
					0,
					100,
				);

			default:
				// For unknown tools, try to extract common fields
				return String(
					input.file_path ||
						input.filePath ||
						input.path ||
						input.command ||
						input.query ||
						"",
				);
		}
	}

	/**
	 * Format the tool action name for display
	 */
	formatToolActionName(
		toolName: string,
		_toolInput: unknown,
		isError: boolean,
	): string {
		const prefix = isError ? "Failed: " : "";
		const normalizedName = this.normalizeToolName(toolName);

		// Add context based on tool type
		switch (normalizedName.toLowerCase()) {
			case "read":
				return `${prefix}Read file`;
			case "edit":
				return `${prefix}Edit file`;
			case "write":
				return `${prefix}Write file`;
			case "bash":
				return `${prefix}Run command`;
			case "glob":
				return `${prefix}Search files`;
			case "grep":
				return `${prefix}Search content`;
			case "todowrite":
				return `${prefix}Update tasks`;
			case "task":
				return `${prefix}Spawn agent`;
			default:
				return `${prefix}${normalizedName}`;
		}
	}

	/**
	 * Format the complete tool result for display
	 */
	formatToolResult(
		toolName: string,
		toolInput: unknown,
		_result: string,
		isError: boolean,
	): string {
		const actionName = this.formatToolActionName(toolName, toolInput, isError);
		const param = this.formatToolParameter(toolName, toolInput);

		if (param) {
			return `${actionName}: ${param}`;
		}
		return actionName;
	}

	/**
	 * Normalize tool name to consistent casing
	 */
	private normalizeToolName(toolName: string): string {
		// OpenCode uses lowercase tool names
		const lowerName = toolName.toLowerCase();

		// Map to display names
		const displayNames: Record<string, string> = {
			read: "Read",
			edit: "Edit",
			write: "Write",
			bash: "Bash",
			glob: "Glob",
			grep: "Grep",
			todowrite: "TodoWrite",
			todoread: "TodoRead",
			task: "Task",
			webfetch: "WebFetch",
			skill: "Skill",
		};

		return displayNames[lowerName] || toolName;
	}
}
