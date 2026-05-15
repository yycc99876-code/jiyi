export type GraphStrength = 'strong' | 'medium' | 'weak'

export type GraphRole = 'claim' | 'evidence' | 'counterargument' | 'transition' | 'conclusion'

export type GraphRelation = 'supports' | 'contradicts' | 'extends' | 'weakens' | 'unrelated'

export type NudgeType = 'contradiction' | 'gap' | 'redundancy' | 'unsupported_claim' | 'missing_conclusion'

export interface GraphParagraph {
  id: string
  text: string
  heading?: string
}

export interface ArgumentNode {
  id: string
  label: string
  paragraph: string
  strength: GraphStrength
  role: GraphRole
  evidenceNote?: string
}

export interface ArgumentEdge {
  from: string
  to: string
  relation: GraphRelation
  explanation?: string
}

export interface ArgumentGraph {
  nodes: ArgumentNode[]
  edges: ArgumentEdge[]
  summary: string
  coherenceScore: number
}

export interface StructuralNudge {
  type: NudgeType
  message: string
  relatedParagraphs: string[]
  severity: 'low' | 'medium' | 'high'
}

export interface CoherenceGhostSuggestion {
  original: string
  replacement: string
  reason: string
  severity: 'minor' | 'moderate' | 'major'
  argumentContext?: string
}

export interface DecisionRecord {
  original: string
  replacement: string
  accepted: boolean
  timestamp: number
  paragraphId?: string
}

export interface CoherenceAgentRequest {
  paragraphs: GraphParagraph[]
  changedParagraphIds: string[]
  previousGraph: ArgumentGraph | null
  previousDecisions: DecisionRecord[]
}

export interface CoherenceAgentResponse {
  graph: ArgumentGraph | null
  ghostSuggestions: CoherenceGhostSuggestion[]
  structuralNudges: StructuralNudge[]
}

// ---------------------------------------------------------------------------
// Canvas Action Types
// ---------------------------------------------------------------------------

export type CanvasActionType = 'strengthen' | 'counterargument' | 'evidence' | 'rewrite'

export interface CanvasActionRequest {
  paragraph: string
  action: CanvasActionType
  context?: string
}

export interface CanvasActionVariant {
  id: string
  text: string
  explanation: string
}

export interface CanvasActionResponse {
  original: string
  action: CanvasActionType
  variants: CanvasActionVariant[]
}

// ---------------------------------------------------------------------------
// Draft Canvas Chat Types
// ---------------------------------------------------------------------------

export type CanvasSuggestionType = 'note' | 'outline' | 'draft' | 'question'

export interface CanvasSuggestion {
  id: string
  type: CanvasSuggestionType
  title: string
  content: string
  actionLabel?: string
}

export interface CanvasChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  suggestions?: CanvasSuggestion[]
}

export interface CanvasChatRequest {
  message: string
  history?: Pick<CanvasChatMessage, 'role' | 'content'>[]
  articleContext?: string
}

export interface CanvasChatResponse {
  reply: string
  suggestions: CanvasSuggestion[]
}
