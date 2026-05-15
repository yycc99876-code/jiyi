import { useState, useCallback, useRef } from 'react'
import type { CanvasActionType, CanvasActionVariant } from '../services/ai/coherenceTypes'

export interface CanvasActionNode {
  id: string
  parentId: string
  action: CanvasActionType
  batchId: string
  text: string
  explanation: string
  status: 'pending' | 'accepted' | 'dismissed'
}

export default function useCanvasActions() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [loadingNodeIds, setLoadingNodeIds] = useState<Set<string>>(new Set())
  const [errorByNode, setErrorByNode] = useState<Map<string, string>>(new Map())
  const [actionNodes, setActionNodes] = useState<Map<string, CanvasActionNode[]>>(new Map())
  const actionNodesRef = useRef(actionNodes)
  const runningKeysRef = useRef<Set<string>>(new Set())
  actionNodesRef.current = actionNodes

  const selectNode = useCallback((nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId))
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedNodeId(null)
  }, [])

  const executeAction = useCallback(
    async (nodeId: string, paragraph: string, action: CanvasActionType, context?: string) => {
      const requestKey = `${nodeId}:${action}`
      if (runningKeysRef.current.has(requestKey)) return

      runningKeysRef.current.add(requestKey)
      setLoadingNodeIds((prev) => new Set(prev).add(nodeId))
      setErrorByNode((prev) => {
        const next = new Map(prev)
        next.delete(nodeId)
        return next
      })

      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 45_000)

      try {
        const res = await fetch('/api/revision/canvas-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paragraph, action, context }),
          signal: controller.signal,
        })

        if (!res.ok) {
          throw new Error('AI 操作没有完成')
        }

        const data = await res.json()
        const variants: CanvasActionVariant[] = Array.isArray(data.variants) ? data.variants : []
        if (variants.length === 0) {
          throw new Error('这次没有生成可用结果')
        }

        const batchId = `batch_${nodeId}_${action}_${Date.now()}`
        const newNodes: CanvasActionNode[] = variants.map((v) => ({
          id: v.id,
          parentId: nodeId,
          action,
          batchId,
          text: v.text,
          explanation: v.explanation,
          status: 'pending' as const,
        }))

        setActionNodes((prev) => {
          const next = new Map(prev)
          const existing = next.get(nodeId) ?? []
          next.set(nodeId, [...existing, ...newNodes])
          return next
        })
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === 'AbortError'
            ? 'AI 操作超时，可以重试'
            : error instanceof Error
              ? error.message
              : 'AI 操作失败，可以重试'
        setErrorByNode((prev) => {
          const next = new Map(prev)
          next.set(nodeId, message)
          return next
        })
      } finally {
        window.clearTimeout(timeout)
        runningKeysRef.current.delete(requestKey)
        setLoadingNodeIds((prev) => {
          const next = new Set(prev)
          next.delete(nodeId)
          return next
        })
      }
    },
    [],
  )

  const acceptVariant = useCallback((variantId: string, parentId: string) => {
    setActionNodes((prev) => {
      const next = new Map(prev)
      const variants = next.get(parentId)
      if (!variants) return prev
      next.set(
        parentId,
        variants.map((v) => {
          if (v.id === variantId) return { ...v, status: 'accepted' as const }
          return { ...v, status: 'dismissed' as const }
        }),
      )
      return next
    })
  }, [])

  const dismissVariant = useCallback((variantId: string, parentId: string) => {
    setActionNodes((prev) => {
      const next = new Map(prev)
      const variants = next.get(parentId)
      if (!variants) return prev
      const filtered = variants.filter((v) => v.id !== variantId)
      if (filtered.length === 0) {
        next.delete(parentId)
      } else {
        next.set(parentId, filtered)
      }
      return next
    })
  }, [])

  const dismissAllForNode = useCallback((parentId: string) => {
    setActionNodes((prev) => {
      const next = new Map(prev)
      next.delete(parentId)
      return next
    })
  }, [])

  const clearAllActions = useCallback(() => {
    setActionNodes(new Map())
    setSelectedNodeId(null)
  }, [])

  return {
    selectedNodeId,
    loadingNodeIds,
    errorByNode,
    actionNodes,
    selectNode,
    clearSelection,
    executeAction,
    acceptVariant,
    dismissVariant,
    dismissAllForNode,
    clearAllActions,
  }
}
