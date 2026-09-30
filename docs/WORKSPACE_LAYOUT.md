# Workspace layout

The workspace-tab layout supersedes the stacked tool accordion described in the original UX specification.

- The top document tabs select the buffer used by tools.
- The workspace strip selects Buffer or one open tool. Sidebar destinations open or select these workspaces; repeated activation preserves the draft.
- Tools use the full working area by default. **Split with buffer** adds one resizable tool pane beside the buffer. **Focus tool** returns to a single pane.
- Split requires at least 1050 pixels after the sidebar. Smaller windows show the selected tool alone and retain the split preference for when space returns.
- Workspace tabs scroll horizontally, support arrow keys/Home/End, and expose an **All workspaces** selector when more than four are open.
- Closing a tool explicitly unmounts it, clears its status and selects a neighbor. Returning to Buffer or changing split mode preserves mounted tool state.
- Only open tool identities persist across launches. Drafts and secrets remain in memory.
- Ctrl+B switches between Buffer and the last tool. Ctrl+Shift+\ toggles split view.

## Implementation

`AppShell` owns responsive sizing and action routing. `WorkspaceTabs` owns navigation. `ToolDock` is a stable host for the tool panels, rendering only the selected panel visibly. The existing `promoted` store property now represents the selected tool workspace; null selects Buffer.

Keep panel instances under stable keys when changing layouts. Hidden panels must not receive actions intended for the visible workspace. Buffer-wide paste ignores hidden buffers and paste events inside the tool pane.

## Verification

- 153 frontend tests passed, including five workspace regression tests for many open tools, draft retention, explicit close, keyboard navigation and unavailable split controls.
- TypeScript and production web build passed.
- Browser layout reviewed at 1440x900, 1024x768 and 800x700 with eight tools open. Browser preview lacks the local WASM engine, so it verifies layout/navigation, not banking operations.
- Preview images: `build/qa/workspace-focus.png` and `build/qa/workspace-split.png`.
