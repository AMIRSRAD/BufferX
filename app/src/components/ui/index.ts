/**
 * BufferX UI primitive library.
 *
 * Every component here implements DESIGN_SYSTEM.md §4 and reads only design
 * tokens — no raw colour, no arbitrary size, no hardcoded theme.
 *
 * Import from the barrel (`@/components/ui`) or from the individual module
 * (`@/components/ui/Button`); both are stable entry points.
 */

export { Button, ICON_PX, ICON_STROKE } from './Button'
export type { ButtonProps, ButtonVariant, ControlSize } from './Button'

export { IconButton } from './IconButton'
export type { IconButtonProps } from './IconButton'

export { Spinner } from './Spinner'
export type { SpinnerProps } from './Spinner'

export { Input } from './Input'
export type { InputProps } from './Input'

export { Textarea } from './Textarea'
export type { TextareaProps } from './Textarea'

export { HexInput, groupHex, normalizeHex } from './HexInput'
export type { HexInputProps } from './HexInput'

export { SecretInput } from './SecretInput'
export type { SecretInputProps } from './SecretInput'

export { Select } from './Select'
export type { SelectOption, SelectProps } from './Select'

export { Combobox } from './Combobox'
export type { ComboboxProps } from './Combobox'

export { Checkbox } from './Checkbox'
export type { CheckboxProps } from './Checkbox'

export { Switch } from './Switch'
export type { SwitchProps } from './Switch'

export { RadioGroup } from './RadioGroup'
export type { RadioGroupProps } from './RadioGroup'

export { SegmentedControl } from './SegmentedControl'
export type { SegmentedControlProps, SegmentedOption } from './SegmentedControl'

export { Tabs } from './Tabs'
export type { TabDescriptor, TabsProps } from './Tabs'

export { Field } from './Field'
export type { FieldProps } from './Field'

export { DataTable } from './DataTable'
export type { DataTableColumn, DataTableProps } from './DataTable'

export { Tree } from './Tree'
export type { TreeNodeBase, TreeNodeMeta, TreeProps } from './Tree'

export { HexViewer, highlightSlot } from './HexViewer'
export type { ByteRange, HexHighlight, HexViewerProps } from './HexViewer'

export { Badge } from './Badge'
export type { BadgeProps, BadgeTone } from './Badge'

export { Tooltip, TooltipProvider } from './Tooltip'
export type { Align, Side, TooltipProps } from './Tooltip'

export { Popover } from './Popover'
export type { PopoverProps } from './Popover'

export { Dialog } from './Dialog'
export type { DialogProps, DialogSize } from './Dialog'

export { InlineAlert } from './InlineAlert'
export type { AlertTone, InlineAlertProps } from './InlineAlert'

export { CopyButton } from './CopyButton'
export type { CopyButtonProps } from './CopyButton'

export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'

export { Skeleton } from './Skeleton'
export type { SkeletonProps } from './Skeleton'

export { SplitPane } from './SplitPane'
export type { SplitPaneProps } from './SplitPane'

export { Kbd } from './Kbd'
export type { KbdProps } from './Kbd'

export { Toaster, toast } from './toast'
export type { ToastOptions } from './toast'
