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

/** Optional context when reporting a `.tres` parse error: 1-based line and full source lines (index 0 = line 1). */
export const parseLineContextSchema = z.object({
  lineNo: z.number().int().positive(),
  allLines: z.array(z.string()),
})
export type ParseLineContext = z.infer<typeof parseLineContextSchema>

const DEFAULT_PARSE_CONTEXT_RADIUS = 2

/** Append “Near line …” source excerpt to a parse error message. */
export function formatParseLineContext(
  message: string,
  ctx: ParseLineContext,
  radius = DEFAULT_PARSE_CONTEXT_RADIUS
): string {
  const { lineNo, allLines } = ctx
  const start = Math.max(1, lineNo - radius)
  const end = Math.min(allLines.length, lineNo + radius)
  const parts: string[] = [message, `Near line ${lineNo}:`]
  for (let n = start; n <= end; n++) {
    const marker = n === lineNo ? '>' : ' '
    const text = allLines[n - 1] ?? ''
    parts.push(`  ${marker} ${n} | ${text}`)
  }
  return parts.join('\n')
}

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
  PropertyValueParseFailed = 'PROPERTY_VALUE_PARSE_FAILED',
  /** `.tres` text has no `[...]` resource sections. */
  ParseNoResourceBlocks = 'PARSE_NO_RESOURCE_BLOCKS',
  /** A header group has no lines (internal consistency). */
  ParseEmptyResource = 'PARSE_EMPTY_RESOURCE',
  /** The leading `gd_resource` block must not contain property lines. */
  ParseBaseResourceHasProperties = 'PARSE_BASE_RESOURCE_HAS_PROPERTIES',
  /** Header line is not `[...]` or is otherwise malformed (detail: the line). */
  ParseResourceHeaderInvalid = 'PARSE_RESOURCE_HEADER_INVALID',
  /** No tokens matched inside a `[...]` header. */
  ParseResourceHeaderEmpty = 'PARSE_RESOURCE_HEADER_EMPTY',
  /** A `name=value` fragment in the header is invalid (detail: fragment). */
  ParseResourceHeaderModifierInvalid = 'PARSE_RESOURCE_HEADER_MODIFIER_INVALID',
  /** Property line does not match `name = value` (detail: the line). */
  ParseResourcePropertyInvalid = 'PARSE_RESOURCE_PROPERTY_INVALID',
}

const nonEmptyString = z.string().min(1)

function buildIssue(severity: IssueSeverity, message: string): Issue {
  return issueSchema.parse({ severity, message })
}

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

    case ErrorCode.PropertyValueParseFailed: {
      z.tuple([z.unknown()]).parse(args)
      const detail = nonEmptyString.parse(args[0])
      return buildIssue(IssueSeverity.Error, `Invalid property value: ${detail}`)
    }

    case ErrorCode.ParseNoResourceBlocks:
      z.tuple([]).parse(args)
      return buildIssue(
        IssueSeverity.Error,
        'No resource blocks found (expected a line starting with `[`, e.g. `[gd_resource ...]`).'
      )

    case ErrorCode.ParseEmptyResource:
      z.tuple([]).parse(args)
      return buildIssue(IssueSeverity.Error, 'Empty resource.')

    case ErrorCode.ParseBaseResourceHasProperties:
      z.tuple([]).parse(args)
      return buildIssue(IssueSeverity.Error, 'Base resource has properties.')

    case ErrorCode.ParseResourceHeaderInvalid: {
      z.tuple([z.unknown()]).parse(args)
      const line = nonEmptyString.parse(args[0])
      return buildIssue(IssueSeverity.Error, `Invalid resource header: "${line}"`)
    }

    case ErrorCode.ParseResourceHeaderEmpty:
      z.tuple([]).parse(args)
      return buildIssue(IssueSeverity.Error, 'Empty resource header string.')

    case ErrorCode.ParseResourceHeaderModifierInvalid: {
      z.tuple([z.unknown()]).parse(args)
      const modText = nonEmptyString.parse(args[0])
      return buildIssue(
        IssueSeverity.Error,
        `Invalid resource header modifier (expected name=value): "${modText}"`
      )
    }

    case ErrorCode.ParseResourcePropertyInvalid: {
      z.tuple([z.unknown()]).parse(args)
      const line = nonEmptyString.parse(args[0])
      return buildIssue(IssueSeverity.Error, `Invalid resource property: "${line}"`)
    }

    default: {
      throw new Error(`Unhandled error code: ${String(code)}`)
    }
  }
}

/** {@link createIssue} message, with optional {@link formatParseLineContext} when `context` is set. */
export function parseErrorText(
  code: ErrorCode,
  context: ParseLineContext | undefined,
  ...args: unknown[]
): string {
  const message = createIssue(code, ...args).message
  return context === undefined ? message : formatParseLineContext(message, context)
}

/** Throws an `Error` built from {@link createIssue} and optional parse line context. */
export function throwParseError(code: ErrorCode, context: ParseLineContext | undefined, ...args: unknown[]): never {
  throw new Error(parseErrorText(code, context, ...args))
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
