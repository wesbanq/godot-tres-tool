import { z } from 'zod'
import * as types from './tres-types'
import {
  coreValidationMessages,
  createIssue,
  createIssueFromCoreValidationMessage,
  ErrorCode,
  IssueSeverity,
  issueSchema,
  type Issue,
} from './errors'

export {
  ErrorCode,
  createIssue,
  createIssueFromCoreValidationMessage,
  IssueSeverity,
  issueSchema,
  type Issue,
} from './errors'

export const analyzerSettingsSchema = z
  .object({
    ignoreFormat: z.boolean().optional(),
    ignoreMultipleGdResource: z.boolean().optional(),
  })
  .transform((s) => ({
    ignoreFormat: s.ignoreFormat ?? false,
    ignoreMultipleGdResource: s.ignoreMultipleGdResource ?? false,
  }))

export type AnalyzerSettings = z.infer<typeof analyzerSettingsSchema>

function mergeSettings(settings: AnalyzerSettings | undefined): AnalyzerSettings {
  return analyzerSettingsSchema.parse(settings ?? {})
}

/** Root must be `gd_resource`; no inner block may repeat `gd_resource`. */
function collectGdResourceLayoutIssues(file: types.ResourceFile, settings: AnalyzerSettings): Issue[] {
  const issues: Issue[] = []
  if (file.header.type !== 'gd_resource') {
    issues.push(createIssue(ErrorCode.BaseNotGdResource))
  }
  const innerHasGdResource = file.resources.some((res) => res.header.type === 'gd_resource')
  if (innerHasGdResource && !settings.ignoreMultipleGdResource) {
    issues.push(createIssue(ErrorCode.MultipleGdResourceInner))
  }
  return issues
}

/** Rules shared with {@link types.ResourceFile.collectValidationErrors} (format / non-empty body). */
function collectCoreDocumentIssues(file: types.ResourceFile, settings: AnalyzerSettings): Issue[] {
  const messages = types.ResourceFile.collectValidationErrors(file.header, file.resources)
  const issues: Issue[] = []
  for (const msg of messages) {
    if (settings.ignoreFormat && msg === coreValidationMessages.baseMissingFormatModifier) {
      continue
    }
    issues.push(createIssueFromCoreValidationMessage(msg))
  }
  return issues
}

/**
 * Root header: optional strict check that `format` is an integer from 1–3 when present.
 * A missing `format` is reported via {@link types.ResourceFile.collectValidationErrors} (unless ignored).
 */
function analyzeRootHeader(header: types.ResourceHeader, settings: AnalyzerSettings): Issue[] {
  const issues: Issue[] = []
  if (settings.ignoreFormat) {
    return issues
  }
  const formatMod = header.getModifier('format')
  if (formatMod === undefined) {
    return issues
  }
  const parsed = types.godotResourceFormatSchema.safeParse(formatMod.value)
  if (!parsed.success) {
    issues.push(createIssue(ErrorCode.SchemaValidationFailed, types.formatZodError(parsed.error)))
  }
  return issues
}

function analyzeEmbeddedHeader(header: types.ResourceHeader): Issue[] {
  const issues: Issue[] = []
  if (header.type.length === 0) {
    issues.push(createIssue(ErrorCode.ResourceHeaderTypeEmpty))
  } else if (!types.resourceTypeSchema.safeParse(header.type).success) {
    issues.push(createIssue(ErrorCode.UnknownResourceHeaderType, header.type))
  }
  for (const mod of header.modifiers) {
    const r = types.resourceTypeModifierJsonSchema.safeParse({ name: mod.name, value: mod.value })
    if (!r.success) {
      issues.push(createIssue(ErrorCode.SchemaValidationFailed, types.formatZodError(r.error)))
    }
  }
  return issues
}

function analyzeResource(resource: types.Resource): Issue[] {
  const issues: Issue[] = []
  issues.push(...analyzeEmbeddedHeader(resource.header))
  for (const prop of resource.properties) {
    const r = types.resourcePropertyJsonSchema.safeParse({ name: prop.name, value: prop.value })
    if (!r.success) {
      issues.push(createIssue(ErrorCode.SchemaValidationFailed, types.formatZodError(r.error)))
    }
  }
  return issues
}

function analyzeRootHeaderShape(header: types.ResourceHeader, settings: AnalyzerSettings): Issue[] {
  const issues: Issue[] = []
  if (header.type.length === 0) {
    issues.push(createIssue(ErrorCode.ResourceHeaderTypeEmpty))
  }
  for (const mod of header.modifiers) {
    const r = types.resourceTypeModifierJsonSchema.safeParse({ name: mod.name, value: mod.value })
    if (!r.success) {
      issues.push(createIssue(ErrorCode.SchemaValidationFailed, types.formatZodError(r.error)))
    }
  }
  issues.push(...analyzeRootHeader(header, settings))
  return issues
}

/**
 * Check structural and basic semantic constraints of a {@link types.ResourceFile}.
 * Does not read `.tres` text; only inspects the in-memory model (independent of the parser).
 */
export function analyzeResourceFile(resourceFile: types.ResourceFile, settings?: AnalyzerSettings): Issue[] {
  const s = mergeSettings(settings)
  const issues: Issue[] = []
  issues.push(...collectGdResourceLayoutIssues(resourceFile, s))
  issues.push(...collectCoreDocumentIssues(resourceFile, s))
  issues.push(...analyzeRootHeaderShape(resourceFile.header, s))
  for (const resource of resourceFile.resources) {
    issues.push(...analyzeResource(resource))
  }
  return issues
}

/** True when {@link analyzeResourceFile} reports no {@link IssueSeverity.Error} issues. */
export function resourceFileIsValid(resourceFile: types.ResourceFile, settings?: AnalyzerSettings): boolean {
  return !analyzeResourceFile(resourceFile, settings).some((i) => i.severity === IssueSeverity.Error)
}
