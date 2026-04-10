import { z } from 'zod'

/** Severity of an analyzer finding. */
export enum IssueSeverity {
  Info,
  Warning,
  Error,
}

export const issueSeveritySchema = z.union([
  z.literal(IssueSeverity.Info),
  z.literal(IssueSeverity.Warning),
  z.literal(IssueSeverity.Error),
])

export const issueSchema = z.object({
  severity: issueSeveritySchema,
  message: z.string().min(1),
})

export type Issue = z.infer<typeof issueSchema>

/** Messages emitted by `ResourceFile.collectValidationErrors` (single source of truth). */
export const coreValidationMessages = {
  noResourcesInFile: 'No resources found in file.',
  baseMissingFormatModifier: 'Base resource header has no format modifier.',
} as const

export type CoreValidationMessage =
  (typeof coreValidationMessages)[keyof typeof coreValidationMessages]

export enum ErrorCode {
  BaseNotGdResource = 'BASE_NOT_GD_RESOURCE',
  MultipleGdResourceInner = 'MULTIPLE_GD_RESOURCE_INNER',
  NoResourcesInFile = 'NO_RESOURCES_IN_FILE',
  BaseMissingFormatModifier = 'BASE_MISSING_FORMAT_MODIFIER',
  ResourceHeaderTypeEmpty = 'RESOURCE_HEADER_TYPE_EMPTY',
  UnknownResourceHeaderType = 'UNKNOWN_RESOURCE_HEADER_TYPE',
  SchemaValidationFailed = 'SCHEMA_VALIDATION_FAILED',
}

const nonEmptyString = z.string().min(1)

function buildIssue(severity: IssueSeverity, message: string): Issue {
  return issueSchema.parse({ severity, message })
}

export function createIssue(code: ErrorCode.BaseNotGdResource): Issue
export function createIssue(code: ErrorCode.MultipleGdResourceInner): Issue
export function createIssue(code: ErrorCode.NoResourcesInFile): Issue
export function createIssue(code: ErrorCode.BaseMissingFormatModifier): Issue
export function createIssue(code: ErrorCode.ResourceHeaderTypeEmpty): Issue
export function createIssue(code: ErrorCode.UnknownResourceHeaderType, typeName: string): Issue
export function createIssue(code: ErrorCode.SchemaValidationFailed, detail: string): Issue
/**
 * Build an {@link Issue} from a stable code and validated arguments.
 * Arguments are checked at runtime (Zod) per code.
 */
export function createIssue(code: ErrorCode, ...args: unknown[]): Issue {
  switch (code) {
    case ErrorCode.BaseNotGdResource:
      z.tuple([]).parse(args)
      return buildIssue(IssueSeverity.Error, 'Base header is not a gd_resource.')

    case ErrorCode.MultipleGdResourceInner:
      z.tuple([]).parse(args)
      return buildIssue(IssueSeverity.Error, 'Multiple gd_resource headers found in file.')

    case ErrorCode.NoResourcesInFile:
      z.tuple([]).parse(args)
      return buildIssue(IssueSeverity.Error, coreValidationMessages.noResourcesInFile)

    case ErrorCode.BaseMissingFormatModifier:
      z.tuple([]).parse(args)
      return buildIssue(IssueSeverity.Error, coreValidationMessages.baseMissingFormatModifier)

    case ErrorCode.ResourceHeaderTypeEmpty:
      z.tuple([]).parse(args)
      return buildIssue(IssueSeverity.Error, 'Resource header type is empty.')

    case ErrorCode.UnknownResourceHeaderType: {
      z.tuple([z.unknown()]).parse(args)
      const typeName = nonEmptyString.parse(args[0])
      return buildIssue(IssueSeverity.Warning, `Unknown resource header type "${typeName}".`)
    }

    case ErrorCode.SchemaValidationFailed: {
      z.tuple([z.unknown()]).parse(args)
      const detail = nonEmptyString.parse(args[0])
      return buildIssue(IssueSeverity.Error, detail)
    }

    default: {
      throw new Error(`Unhandled error code: ${String(code)}`)
    }
  }
}

/** Map {@link coreValidationMessages} lines to {@link ErrorCode} for analyzer filtering. */
export const coreValidationMessageToCode: Record<CoreValidationMessage, ErrorCode> = {
  [coreValidationMessages.noResourcesInFile]: ErrorCode.NoResourcesInFile,
  [coreValidationMessages.baseMissingFormatModifier]: ErrorCode.BaseMissingFormatModifier,
}

export function createIssueFromCoreValidationMessage(message: string): Issue {
  const code = coreValidationMessageToCode[message as CoreValidationMessage]
  if (code === undefined) {
    throw new Error(`Unknown core validation message: ${message}`)
  }
  return createIssue(code)
}
