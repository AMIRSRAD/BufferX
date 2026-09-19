/**
 * The tool registry — the contract between the shell and the tools.
 *
 * The shell never imports a panel directly. It walks `TOOLS` to build the rail
 * (UX_SPEC 1.2), the dock accordion (1.1), the command palette's `/` scope
 * (4.1) and the capability gating in 5.7. A tool is added by appending one
 * entry here and writing its panel; nothing in `@/shell` changes.
 *
 * Every panel is `React.lazy`, so a heavy tool (the TLV tree, the Network
 * history) is fetched on first open rather than on first paint. The shell wraps
 * each mount in a `Suspense` boundary whose fallback is a `Skeleton` matching
 * the panel's shape.
 */

import { lazy, type ComponentType } from 'react'
import {
  FileKey2,
  Info,
  KeyRound,
  Languages,
  Library,
  ListTree,
  Lock,
  Network,
  Settings2,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

/** Rail grouping. Groups render in this order, separated by 1px dividers. */
export type ToolGroup = 'workspace' | 'analyze' | 'security' | 'utilities' | 'system'

/**
 * A host power the tool needs. When the active transport lacks it the tool is
 * still listed and still opens — it renders disabled with a stated reason
 * (UX_SPEC 5.7: "gated, never hidden").
 */
export type ToolCapability = 'tcp' | 'files' | 'keyFiles' | 'desktop'

export interface ToolDefinition {
  /** Stable id. Used by `useTools`, the persisted open-tool list, and the palette. */
  id: string
  /** Human title. Shown in the rail, the dock header and the palette. */
  title: string
  icon: LucideIcon
  group: ToolGroup
  /** Display form of the binding that opens it, e.g. `Alt+4`. */
  shortcut?: string
  requires?: ToolCapability
  Panel: ComponentType
}

/**
 * Declared in rail order (UX_SPEC 1.2). `Buffer` and `History` are rail
 * destinations owned by the shell rather than dock tools, so they are not
 * listed here — see `Rail.tsx`.
 */
export const TOOLS: ToolDefinition[] = [
  {
    id: 'tlv',
    title: 'TLV',
    icon: ListTree,
    group: 'analyze',
    shortcut: 'Alt+2',
    Panel: lazy(() => import('@/tools/tlv/TlvPanel')),
  },
  {
    id: 'iransystem',
    title: 'IranSystem',
    icon: Languages,
    group: 'analyze',
    shortcut: 'Alt+3',
    Panel: lazy(() => import('@/tools/iransystem/IranSystemPanel')),
  },
  {
    id: 'mac',
    title: 'MAC',
    icon: ShieldCheck,
    group: 'security',
    shortcut: 'Alt+4',
    Panel: lazy(() => import('@/tools/mac/MacPanel')),
  },
  {
    id: 'pin',
    title: 'PIN',
    icon: KeyRound,
    group: 'security',
    shortcut: 'Alt+5',
    Panel: lazy(() => import('@/tools/pin/PinPanel')),
  },
  {
    id: 'crypto',
    title: 'Crypto',
    icon: Lock,
    group: 'security',
    shortcut: 'Alt+6',
    Panel: lazy(() => import('@/tools/crypto/CryptoPanel')),
  },
  {
    id: 'rsa',
    title: 'RSA',
    icon: FileKey2,
    group: 'security',
    shortcut: 'Alt+7',
    Panel: lazy(() => import('@/tools/rsa/RsaPanel')),
  },
  {
    id: 'library',
    title: 'Saved',
    icon: Library,
    group: 'utilities',
    // Reads a folder of .bxb documents, so it needs a filesystem. The rail
    // shows it as limited rather than hiding it, per UX_SPEC 5.7.
    requires: 'files',
    Panel: lazy(() => import('@/tools/library/LibraryPanel')),
  },
  {
    id: 'toolbox',
    title: 'Toolbox',
    icon: Wrench,
    group: 'utilities',
    shortcut: 'Alt+8',
    Panel: lazy(() => import('@/tools/toolbox/ToolboxPanel')),
  },
  {
    id: 'network',
    title: 'Network',
    icon: Network,
    group: 'utilities',
    shortcut: 'Alt+9',
    requires: 'tcp',
    Panel: lazy(() => import('@/tools/network/NetworkPanel')),
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: Settings2,
    group: 'system',
    shortcut: 'Ctrl+,',
    Panel: lazy(() => import('@/tools/settings/SettingsPanel')),
  },
  {
    id: 'about',
    title: 'About',
    icon: Info,
    group: 'system',
    Panel: lazy(() => import('@/tools/about/AboutPanel')),
  },
]

const BY_ID: ReadonlyMap<string, ToolDefinition> = new Map(TOOLS.map((tool) => [tool.id, tool]))

/** Looks a tool up by id. Returns `undefined` for an unknown or stale id. */
export function getTool(id: string): ToolDefinition | undefined {
  return BY_ID.get(id)
}

/** Resolves a list of ids to definitions, dropping ids that no longer exist. */
export function resolveTools(ids: readonly string[]): ToolDefinition[] {
  const resolved: ToolDefinition[] = []
  for (const id of ids) {
    const tool = BY_ID.get(id)
    if (tool) resolved.push(tool)
  }
  return resolved
}

/** Every tool in one group, in declaration order. */
export function toolsInGroup(group: ToolGroup): ToolDefinition[] {
  return TOOLS.filter((tool) => tool.group === group)
}
