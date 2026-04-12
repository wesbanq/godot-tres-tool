import { z } from 'zod'
import * as types from './tres-types'
import {
  coreValidationMessages,
  createIssue,
  ErrorCode,
  formatZodError,
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

function filterIssuesForSettings(issues: Issue[], settings: AnalyzerSettings): Issue[] {
  if (!settings.ignoreFormat) {
    return issues
  }
  return issues.filter((i) => i.message !== coreValidationMessages.baseMissingFormatModifier)
}

/**
 * Root header: optional strict check that `format` is an integer from 1–3 when present.
 * A missing `format` is reported via {@link types.ResourceFile.validate} (unless filtered by settings).
 */
function analyzeRootHeaderFormat(header: types.ResourceHeader, settings: AnalyzerSettings): Issue[] {
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
    issues.push(createIssue(ErrorCode.SchemaValidationFailed, formatZodError(parsed.error)))
  }
  return issues
}

/**
 * Check structural and basic semantic constraints of a {@link types.ResourceFile}.
 * Does not read `.tres` text; only inspects the in-memory model (independent of the parser).
 * Runs {@link types.ResourceFile.validate} plus layout and root `format` range rules.
 */
export function analyzeResourceFile(resourceFile: types.ResourceFile, settings?: AnalyzerSettings): Issue[] {
  const s = mergeSettings(settings)
  const issues: Issue[] = []
  issues.push(...collectGdResourceLayoutIssues(resourceFile, s))
  issues.push(...filterIssuesForSettings(resourceFile.validate(), s))
  issues.push(...analyzeRootHeaderFormat(resourceFile.header, s))
  return issues
}

/** True when {@link analyzeResourceFile} reports no {@link IssueSeverity.Error} issues. */
export function resourceFileIsValid(resourceFile: types.ResourceFile, settings?: AnalyzerSettings): boolean {
  return !analyzeResourceFile(resourceFile, settings).some((i) => i.severity === IssueSeverity.Error)
}
