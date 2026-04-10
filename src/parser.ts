import fs from 'node:fs'
import * as analyzer from './analyzer'
import {
  ErrorCode,
  IssueSeverity,
  parseErrorText,
  throwParseError,
  type ParseLineContext,
} from './errors'
import * as types from './tres-types'

export { parseLineContextSchema, type ParseLineContext } from './errors'

/** Thrown when `.tres` parsing reports one or more issues. */
export class ParseAggregateError extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(errors.join('\n\n'))
    this.name = 'ParseAggregateError'
    this.errors = errors
  }
}

type LineRef = { text: string; lineNo: number }

/** Removes paired surrounding `"` repeatedly (Godot may wrap modifier values in quotes). */
function stripOuterQuotes(raw: string): string {
  let s = raw.trim()
  while (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    s = s.slice(1, -1)
  }
  return s
}
/** One group per `[...]` header line and its following non-empty lines until the next header. */
function groupLinesByHeader(lines: LineRef[]): LineRef[][] {
  const groupedLines: LineRef[][] = []
  let currentGroup: LineRef[] | null = null
  for (const line of lines) {
    if (line.text.startsWith('[')) {
      if (currentGroup !== null && currentGroup.length > 0) {
        groupedLines.push(currentGroup)
      }
      currentGroup = [line]
    } else if (line.text.trim().length > 0) {
      if (currentGroup === null) {
        continue
      }
      currentGroup.push(line)
    }
  }
  if (currentGroup !== null && currentGroup.length > 0) {
    groupedLines.push(currentGroup)
  }

  return groupedLines
}

/**
 * Parses `.tres` text into a {@link types.ResourceFile} without document-level validation.
 * The first block must have no property lines (otherwise those lines would be dropped from the model).
 * Line/header/property syntax errors are collected and reported via {@link ParseAggregateError}.
 */
export function parseResourceContent(source: string): types.ResourceFile {
  const allLines = source.split(/\r?\n/)
  const nonEmpty: LineRef[] = []
  for (let i = 0; i < allLines.length; i++) {
    const text = allLines[i]
    if (text.trim().length > 0) {
      nonEmpty.push({ text, lineNo: i + 1 })
    }
  }

  const groupedLines = groupLinesByHeader(nonEmpty)
  const errors: string[] = []

  if (groupedLines.length === 0) {
    errors.push(
      parseErrorText(ErrorCode.ParseNoResourceBlocks, {
        lineNo: 1,
        allLines: allLines.length > 0 ? allLines : [''],
      })
    )
    throw new ParseAggregateError(errors)
  }

  const headerLineNos = groupedLines.map((g) => g[0].lineNo)
  const resources: types.Resource[] = []

  for (const res of groupedLines) {
    if (res.length === 0) {
      errors.push(
        parseErrorText(ErrorCode.ParseEmptyResource, { lineNo: headerLineNos[0] ?? 1, allLines })
      )
      continue
    }

    const headerLine = res[0]
    let header: types.ResourceHeader | undefined
    try {
      header = parseResourceHeader(headerLine.text, {
        lineNo: headerLine.lineNo,
        allLines,
      })
    } catch (e) {
      errors.push((e as Error).message)
    }

    const properties: types.ResourceProperty[] = []
    for (const prop of res.slice(1)) {
      try {
        properties.push(
          parseResourceProperty(prop.text, { lineNo: prop.lineNo, allLines })
        )
      } catch (e) {
        errors.push((e as Error).message)
      }
    }

    if (header !== undefined) {
      resources.push(new types.Resource(header, properties))
    }
  }

  if (errors.length > 0) {
    throw new ParseAggregateError(errors)
  }

  if (resources[0].properties.length > 0) {
    const firstProp = groupedLines[0][1]
    throw new ParseAggregateError([
      parseErrorText(ErrorCode.ParseBaseResourceHasProperties, {
        lineNo: firstProp.lineNo,
        allLines,
      }),
    ])
  }

  const fileHeader = resources[0].header
  const inner = resources.slice(1)
  return types.ResourceFile.fromParsedTres(fileHeader, inner)
}

/**
 * Like {@link parseResourceContent}, then runs the analyzer; throws {@link ParseAggregateError}
 * if syntax parsing failed (same as {@link parseResourceContent}) or any analyzer error is reported.
 */
export function parseResourceContentStrict(source: string): types.ResourceFile {
  const file = parseResourceContent(source)
  const issues = analyzer.analyzeResourceFile(file)
  const errors = issues.filter((i) => i.severity === IssueSeverity.Error)
  if (errors.length > 0) {
    throw new ParseAggregateError(errors.map((e) => e.message))
  }
  return file
}

/** Reads a `.tres` file and parses it with {@link parseResourceContentStrict}. */
export function parseResourceFile(filePath: string): types.ResourceFile {
  return parseResourceContentStrict(fs.readFileSync(filePath, 'utf8'))
}

/** Parses `[type name=value ...]` into a {@link types.ResourceHeader}. */
export function parseResourceHeader(line: string, context?: ParseLineContext): types.ResourceHeader {
  if (!line.startsWith('[') || !line.endsWith(']')) {
    throwParseError(ErrorCode.ParseResourceHeaderInvalid, context, line)
  }

  const things = [...line.matchAll(/[^ \]\[]+/g)]
  if (!things || things.length === 0) {
    throwParseError(ErrorCode.ParseResourceHeaderEmpty, context)
  }

  const modifiers = things.slice(1).map((modifier) => {
    const modText = modifier[0]
    const eq = modText.indexOf('=')
    if (eq <= 0) {
      throwParseError(ErrorCode.ParseResourceHeaderModifierInvalid, context, modText)
    }
    const name = modText.slice(0, eq)
    const value = stripOuterQuotes(modText.slice(eq + 1))
    return { name, value }
  })

  const rawHeader = { type: things[0][0], modifiers }
  const parsed = types.resourceHeaderSchema.safeParse(rawHeader)
  if (!parsed.success) {
    throwParseError(ErrorCode.SchemaValidationFailed, context, types.formatZodError(parsed.error))
  }

  return new types.ResourceHeader(
    parsed.data.type,
    parsed.data.modifiers.map((m) => new types.ResourceTypeModifier(m.name, m.value))
  )
}

const ARRAY_PREFIX = 'Array['

function isAsciiWhitespace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v'
}

/**
 * Parses the RHS of `name = value` into a {@link types.PropertyValue}.
 * Whitespace is ignored between tokens; the entire input must be consumed (no trailing junk).
 * Strings must be double-quoted; bare identifiers (other than null/true/false/numbers) are rejected.
 */
export function parsePropertyValue(rhs: string, context?: ParseLineContext): types.PropertyValue {
  const source = rhs.trim()
  if (source.length === 0) {
    throwParseError(ErrorCode.PropertyValueParseFailed, context, 'Property value is empty.')
  }
  const parser = new PropertyRhsParser(source, context)
  let value: types.PropertyValue
  try {
    value = parser.parseValue()
    parser.skipWhitespace()
    if (!parser.isEof()) {
      throwParseError(
        ErrorCode.PropertyValueParseFailed,
        context,
        `Unexpected trailing content after property value (at column ${parser.pos + 1}): ${JSON.stringify(parser.remaining())}`
      )
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('Near line')) {
      throw e
    }
    if (e instanceof Error && e.message.startsWith('Invalid property value:')) {
      throw e
    }
    const detail = e instanceof Error ? e.message : String(e)
    throwParseError(ErrorCode.PropertyValueParseFailed, context, detail)
  }

  const validated = types.propertyValueSchema.safeParse(value)
  if (!validated.success) {
    throwParseError(ErrorCode.SchemaValidationFailed, context, types.formatZodError(validated.error))
  }
  return validated.data
}

class PropertyRhsParser {
  readonly source: string
  pos = 0

  constructor(
    source: string,
    private readonly context?: ParseLineContext
  ) {
    this.source = source
  }

  private fail(message: string): never {
    throw new Error(message)
  }

  isEof(): boolean {
    return this.pos >= this.source.length
  }

  remaining(): string {
    return this.source.slice(this.pos)
  }

  skipWhitespace(): void {
    while (this.pos < this.source.length && isAsciiWhitespace(this.source[this.pos]!)) {
      this.pos++
    }
  }

  peek(): string | undefined {
    return this.source[this.pos]
  }

  /** Parse one property value; leading whitespace is skipped. */
  parseValue(): types.PropertyValue {
    this.skipWhitespace()
    if (this.isEof()) {
      this.fail('Expected a property value but found end of input.')
    }

    const c = this.peek()!

    if (c === '"') {
      return this.parseStringLiteral()
    }

    if (this.startsWithAt(ARRAY_PREFIX, this.pos)) {
      return this.parseArray()
    }

    if (this.tryParseExtOrSubResource()) {
      return this.parseExtOrSubResource()
    }

    if (c === '-' || c === '.' || (c >= '0' && c <= '9')) {
      return this.parseNumber()
    }

    if (this.startsWithAt('null', this.pos)) {
      return this.parseNull()
    }
    if (this.startsWithAt('true', this.pos)) {
      return this.parseBoolean(true)
    }
    if (this.startsWithAt('false', this.pos)) {
      return this.parseBoolean(false)
    }

    this.fail(
      `Invalid property value start at column ${this.pos + 1}: expected quoted string, Array[...], number, null, true, false, ExtResource(...), or SubResource(...); got ${JSON.stringify(this.remaining().slice(0, 40))}`
    )
  }

  private startsWithAt(prefix: string, index: number): boolean {
    return this.source.startsWith(prefix, index)
  }

  private parseNull(): null {
    const end = this.pos + 4
    if (end > this.source.length || !this.startsWithAt('null', this.pos)) {
      this.fail('Expected "null".')
    }
    if (end < this.source.length && this.isWordChar(this.source[end]!)) {
      this.fail('Unexpected token after "null" (unquoted word).')
    }
    this.pos = end
    return null
  }

  private parseBoolean(b: boolean): boolean {
    const word = b ? 'true' : 'false'
    const end = this.pos + word.length
    if (end > this.source.length || !this.startsWithAt(word, this.pos)) {
      this.fail(`Expected "${word}".`)
    }
    if (end < this.source.length && this.isWordChar(this.source[end]!)) {
      this.fail(`Unexpected token after "${word}" (unquoted word).`)
    }
    this.pos = end
    return b
  }

  private isWordChar(c: string): boolean {
    return /[0-9A-Za-z_]/.test(c)
  }

  private parseNumber(): number {
    const start = this.pos
    if (this.peek() === '-') {
      this.pos++
    }

    const hasDigits = (from: number): boolean => {
      let j = from
      while (j < this.source.length && this.source[j]! >= '0' && this.source[j]! <= '9') {
        j++
      }
      return j > from
    }

    if (this.peek() === '.') {
      this.pos++
      if (!hasDigits(this.pos)) {
        this.fail('Invalid number: expected digits after ".".')
      }
      while (this.pos < this.source.length && this.source[this.pos]! >= '0' && this.source[this.pos]! <= '9') {
        this.pos++
      }
    } else {
      if (!hasDigits(this.pos)) {
        this.fail('Invalid number: expected digits.')
      }
      while (this.pos < this.source.length && this.source[this.pos]! >= '0' && this.source[this.pos]! <= '9') {
        this.pos++
      }
      if (this.peek() === '.') {
        this.pos++
        while (this.pos < this.source.length && this.source[this.pos]! >= '0' && this.source[this.pos]! <= '9') {
          this.pos++
        }
      }
    }

    if (this.peek() === 'e' || this.peek() === 'E') {
      this.pos++
      if (this.peek() === '+' || this.peek() === '-') {
        this.pos++
      }
      if (!hasDigits(this.pos)) {
        this.fail('Invalid number: expected exponent digits.')
      }
      while (this.pos < this.source.length && this.source[this.pos]! >= '0' && this.source[this.pos]! <= '9') {
        this.pos++
      }
    }

    const slice = this.source.slice(start, this.pos)
    const n = Number(slice)
    if (!Number.isFinite(n)) {
      this.fail(`Invalid number: ${JSON.stringify(slice)}`)
    }
    if (this.pos < this.source.length && this.isWordChar(this.source[this.pos]!)) {
      this.fail(`Unexpected token after number (unquoted word): ${JSON.stringify(slice)}`)
    }
    return n
  }

  /**
   * Double-quoted string; `pos` must be on opening `"`. Consumes closing `"`.
   * Supports `\\`, `\"`, `\n`, `\r`, `\t`, and `\uXXXX`.
   */
  private parseStringLiteral(): string {
    if (this.peek() !== '"') {
      this.fail('Expected opening double quote for string literal.')
    }
    this.pos++
    let out = ''
    while (this.pos < this.source.length) {
      const c = this.source[this.pos]!
      if (c === '"') {
        this.pos++
        return out
      }
      if (c === '\\') {
        this.pos++
        if (this.pos >= this.source.length) {
          this.fail('Unterminated string escape at end of input.')
        }
        const e = this.source[this.pos]!
        this.pos++
        switch (e) {
          case '\\':
            out += '\\'
            break
          case '"':
            out += '"'
            break
          case 'n':
            out += '\n'
            break
          case 'r':
            out += '\r'
            break
          case 't':
            out += '\t'
            break
          case 'u': {
            const hex = this.source.slice(this.pos, this.pos + 4)
            if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
              this.fail('Invalid \\u escape in string (expected four hex digits).')
            }
            out += String.fromCodePoint(parseInt(hex, 16))
            this.pos += 4
            break
          }
          default:
            this.fail(`Unknown string escape: \\${e}`)
        }
        continue
      }
      out += c
      this.pos++
    }
    this.fail('Unterminated string literal (missing closing ").')
  }

  /** Find index of closing `]` matching the `[` opened right before `innerStart` (depth 1 inside type). */
  private findMatchingBracketClose(innerStart: number): number {
    let depth = 1
    let i = innerStart
    while (i < this.source.length) {
      const c = this.source[i]!
      if (c === '"') {
        i = this.skipStringLiteralFromOpenQuote(i)
        continue
      }
      if (c === '[') {
        depth++
        i++
        continue
      }
      if (c === ']') {
        depth--
        if (depth === 0) {
          return i
        }
        i++
        continue
      }
      i++
    }
    this.fail('Unclosed "[" in Array[...] type segment.')
  }

  /** `i` is index of opening `"`; returns index just after closing `"`. */
  private skipStringLiteralFromOpenQuote(i: number): number {
    let j = i + 1
    while (j < this.source.length) {
      const c = this.source[j]!
      if (c === '"') {
        return j + 1
      }
      if (c === '\\') {
        j++
        if (j >= this.source.length) {
          this.fail('Unterminated string inside bracket scan.')
        }
        const e = this.source[j]!
        j++
        if (e === 'u') {
          if (j + 4 > this.source.length) {
            this.fail('Unterminated string inside bracket scan.')
          }
          j += 4
        }
        continue
      }
      j++
    }
    this.fail('Unterminated string inside bracket scan.')
  }

  private parseArray(): types.PropertyArray {
    if (!this.startsWithAt(ARRAY_PREFIX, this.pos)) {
      this.fail('Expected Array[...].')
    }
    this.pos += ARRAY_PREFIX.length
    const typeInnerStart = this.pos
    const typeClose = this.findMatchingBracketClose(typeInnerStart)
    const typeSlice = this.source.slice(typeInnerStart, typeClose).trim()
    this.pos = typeClose + 1
    this.skipWhitespace()
    if (this.peek() !== '(') {
      this.fail('Expected "(" after Array[...] type (Godot form Array[type]([...])).')
    }
    this.pos++
    this.skipWhitespace()
    if (this.peek() !== '[') {
      this.fail('Expected "[" after Array[...]( to start item list.')
    }
    this.pos++

    const items: types.PropertyValue[] = []
    while (true) {
      this.skipWhitespace()
      if (this.peek() === ']') {
        this.pos++
        break
      }
      items.push(this.parseValue())
      this.skipWhitespace()
      if (this.peek() === ']') {
        this.pos++
        break
      }
      if (this.peek() !== ',') {
        this.fail('Expected "," or "]" between Array elements.')
      }
      this.pos++
    }

    this.skipWhitespace()
    if (this.peek() !== ')') {
      this.fail('Expected ")" to close Array[...]([...]).')
    }
    this.pos++

    const typeParser = new PropertyRhsParser(typeSlice, this.context)
    const typeVal = typeParser.parseValue()
    typeParser.skipWhitespace()
    if (!typeParser.isEof()) {
      this.fail(
        `Unexpected trailing content in Array type segment: ${JSON.stringify(typeParser.remaining())}`
      )
    }

    return { type: typeVal, items }
  }

  private matchExtResourceOpen(): boolean {
    return /^ExtResource\s*\(/i.test(this.source.slice(this.pos))
  }

  private matchSubResourceOpen(): boolean {
    return /^SubResource\s*\(/i.test(this.source.slice(this.pos))
  }

  private tryParseExtOrSubResource(): boolean {
    return this.matchExtResourceOpen() || this.matchSubResourceOpen()
  }

  /**
   * Parse `ExtResource("id")` or `SubResource("id")` (case-insensitive name) and return the exact
   * substring from the source (validated later by {@link types.propertyValueSchema}).
   */
  private parseExtOrSubResource(): string {
    const start = this.pos
    const head = this.source.slice(this.pos)
    const mExt = head.match(/^ExtResource\s*\(/i)
    const mSub = head.match(/^SubResource\s*\(/i)
    let openLen: number
    if (mExt && mExt.index === 0) {
      openLen = mExt[0].length
    } else if (mSub && mSub.index === 0) {
      openLen = mSub[0].length
    } else {
      this.fail('Expected ExtResource(...) or SubResource(...).')
    }
    this.pos += openLen
    this.skipWhitespace()
    if (this.peek() !== '"') {
      this.fail('Expected quoted resource id inside ExtResource/SubResource(...).')
    }
    this.parseStringLiteral()
    this.skipWhitespace()
    if (this.peek() !== ')') {
      this.fail('Expected ")" after ExtResource/SubResource argument.')
    }
    this.pos++
    return this.source.slice(start, this.pos)
  }
}

/** Parses `name = value` (single `=`); value is parsed as {@link types.PropertyValue}. */
export function parseResourceProperty(line: string, context?: ParseLineContext): types.ResourceProperty {
  const property = /([^ =]+) ?= ?(.*)/g.exec(line)
  if (!property) {
    throwParseError(ErrorCode.ParseResourcePropertyInvalid, context, line)
  }

  const name = property[1]
  const value = parsePropertyValue(property[2], context)

  const parsed = types.resourcePropertySchema.safeParse({ name, value })
  if (!parsed.success) {
    throwParseError(ErrorCode.SchemaValidationFailed, context, types.formatZodError(parsed.error))
  }

  return new types.ResourceProperty(parsed.data.name, parsed.data.value)
}
