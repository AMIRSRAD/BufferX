/**
 * The BufferX state layer.
 *
 * Four stores, each owning one concern, each imported directly from
 * `@/store/<name>` in application code. This barrel exists for tests, for the
 * app shell's boot sequence, and for the rare consumer that needs several at
 * once.
 *
 * Persistence policy, in one place:
 *
 * | Store      | Storage key         | Persisted                          |
 * |------------|---------------------|------------------------------------|
 * | `settings` | `bufferx.settings`  | theme, density, railLabeled, legacyEngine |
 * | `settings` | `bufferx.theme`     | theme mirror for the pre-paint bootstrap  |
 * | `tools`    | `bufferx.tools`     | the open-tool id list, nothing else |
 * | `buffers`  | --                  | **never** (holds PANs, track data, PIN blocks) |
 * | `problems` | --                  | **never** (messages quote field values) |
 *
 * Every write goes through the allowlist helper in `./persist`, which drops
 * secret-shaped keys at any depth and refuses at load time to build a binding
 * that names one (UX_SPEC 5.5).
 *
 * Importing this module (or `@/store/settings`) applies `data-theme` and
 * `data-density` to `<html>` as a side effect, so import it once during boot.
 */

export {
  useSettings,
  applyDocumentSettings,
  settingsPersistence,
  SETTINGS_PERSISTED_KEYS,
} from './settings'
export type { SettingsState, SettingsPersistedKey, Theme, Density } from './settings'

export {
  useBuffers,
  CLOSED_HISTORY_LIMIT,
  DEFAULT_HEADER,
  DEFAULT_PACKAGER,
} from './buffers'
export type {
  BuffersState,
  BufferTab,
  BufferPatch,
  ClosedTab,
  CloseTabOptions,
  CloseTabResult,
  FieldRow,
  HeaderConfig,
  NewTabInit,
} from './buffers'

export { useTools, toolsPersistence, TOOL_IDS, TOOLS_PERSISTED_KEYS } from './tools'
export type { ToolsState, ToolId, ToolsPersistedKey } from './tools'

export { useProblems, PROBLEM_LIMIT } from './problems'
export type { ProblemsState, Problem, ProblemInput, ProblemCounts, ProblemSeverity } from './problems'

export {
  STORAGE_KEYS,
  persistence,
  assertPersistable,
  scrubForPersist,
  isForbiddenKey,
  tokenizeKey,
} from './persist'
export type { Persistence, PersistenceConfig, StorageKey, DroppedKey } from './persist'
