"use client"

import { cn } from "@/lib/utils"
import { Children, useRef, useEffect } from "react"
import useAutoScroll from "./use-auto-scroll"


export type ChatContainerProps = {
  children: React.ReactNode
  className?: string
  autoScroll?: boolean
  scrollToRef?: React.RefObject<HTMLDivElement | null>
  ref?: React.RefObject<HTMLDivElement | null>
} & React.HTMLAttributes<HTMLDivElement>

function ChatContainer({
  className,
  children,
  autoScroll = true,
  scrollToRef,
  ref,
  ...props
}: ChatContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const localBottomRef = useRef<HTMLDivElement>(null)
  const bottomRef = scrollToRef || localBottomRef
  const chatContainerRef = ref || containerRef
  const prevChildrenRef = useRef<React.ReactNode>(null)
  const contentChangedWithoutNewMessageRef = useRef(false)

  const {
    scrollToBottom,
    newMessageAdded,
    setNewMessageAdded,
    prevChildrenCountRef,
  } = useAutoScroll(chatContainerRef, autoScroll)

  useEffect(() => {
    const childrenArray = Children.toArray(children)
    const currentChildrenCount = childrenArray.length

    if (currentChildrenCount > prevChildrenCountRef.current) {
      setNewMessageAdded(true)
    } else if (prevChildrenRef.current !== children) {
      contentChangedWithoutNewMessageRef.current = true
    }

    prevChildrenCountRef.current = currentChildrenCount
    prevChildrenRef.current = children
  }, [children, setNewMessageAdded, prevChildrenCountRef])

  useEffect(() => {
    if (!autoScroll) return

    const scrollHandler = () => {
      if (newMessageAdded) {
        scrollToBottom("smooth")
      }
    }

    scrollHandler()
  }, [autoScroll, newMessageAdded, scrollToBottom, prevChildrenCountRef])

  return (
    <div
      className={cn("flex flex-col overflow-y-auto", className)}
      role="log"
      ref={chatContainerRef}
      {...props}
    >
      {children}
      <div
        ref={bottomRef}
        className="h-[1px] w-full flex-shrink-0 scroll-mt-4"
        aria-hidden="true"
      />
    </div>
  )
}

export { ChatContainer }
