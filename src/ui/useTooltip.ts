import { useState } from 'react'
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
} from '@floating-ui/react'

/**
 * Shared hover/focus tooltip wiring (Floating UI — grounded in its React docs).
 * Returns the open state plus reference/floating props to spread; flip + shift
 * keep the card on-screen near any edge, autoUpdate repositions on scroll/resize,
 * and useRole/useFocus/useDismiss make it keyboard- + a11y-correct. Consumers
 * render the floating card inside a FloatingPortal so it escapes overflow.
 */
export function useTooltip() {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top',
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const hover = useHover(context, { move: false, restMs: 60, delay: { open: 40, close: 0 } })
  const focus = useFocus(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  const interactions = useInteractions([hover, focus, dismiss, role])
  return { open, refs, floatingStyles, ...interactions }
}
