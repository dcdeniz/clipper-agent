/** Public barrel for the prompts module (global agent prompt management). */
export { BUILTIN_PROMPTS } from './builtins.js';
export { extractVariables, interpolate } from './interpolate.js';
export { FilePromptStore, compareVersions, type FilePromptStoreOptions } from './store.js';
