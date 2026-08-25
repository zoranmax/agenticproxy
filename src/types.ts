/**
 * Capabilities configuration for a model or provider.
 */
export interface ModelCapabilities {
  toolCalling?: boolean;
  imageInput?: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

/**
 * Manual override or custom model definition for an endpoint.
 */
export interface CustomModelOverride {
  /** Model ID recognized by the OpenAI-compatible endpoint (e.g. "qwen2.5:72b" or "deepseek-coder") */
  modelId: string;
  /** Optional custom human-readable display label */
  displayName?: string;
  /** Capabilities specific to this model override */
  capabilities?: ModelCapabilities;
}

/**
 * Provider entry stored in Memento (context.globalState).
 * NOTE: API keys are NEVER stored here. They are stored in SecretStorage keyed by `id`.
 */
export interface ProviderEntry {
  /** Internal stable UUID */
  id: string;
  /** Human-facing nickname / label (e.g. "Local Ollama", "DeepSeek", "RunPod vLLM") */
  nickname: string;
  /** Base URL of the OpenAI-compatible endpoint (e.g. "http://localhost:11434/v1") */
  baseUrl: string;
  /** Timestamp when provider was added */
  createdAt: number;
  /** Optional default capabilities applied to models discovered from this endpoint */
  defaultCapabilities?: ModelCapabilities;
  /** Optional manual model overrides or explicit models when /v1/models is incomplete */
  customModels?: CustomModelOverride[];
  /** Optional custom HTTP headers (e.g. organization, project) as JSON key-value pairs (non-sensitive) */
  customHeaders?: Record<string, string>;
  /** Model IDs discovered from the endpoint's /v1/models, persisted for offline display */
  discoveredModels?: string[];
}

/**
 * OpenAI chat completion message format
 */
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
}

export interface OpenAIChatChunkDelta {
  role?: string;
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

export interface OpenAIChatChunk {
  id?: string;
  choices?: Array<{
    index: number;
    delta?: OpenAIChatChunkDelta;
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface OpenAIModelItem {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

export interface OpenAIModelsResponse {
  object?: string;
  data?: OpenAIModelItem[];
}
