// Loading and normalizing logic for testcases.yaml.

import { parseAutolinkRules, type AutolinkRule } from "./autolinks";
import { readFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { parse } from "yaml";
import { warn } from "./warnings";

export interface Step {
  action: string;
  expected: string;
}

export interface Skip {
  /** Required: why this case can't be run right now. */
  reason: string;
  /** Optional release condition (ticket id, release name, ...). */
  until?: string;
}

export interface TestCase {
  name: string;
  category?: string;
  test_data?: unknown;
  preconditions?: unknown[];
  steps: Step[];
  notes?: string | null;
  /** Explicit stable ID. Takes precedence over the sequential fallback in assignTestCaseIds. */
  id?: string;
  /** Stable reference into the pre-migration source (e.g. a Confluence row id). Traceability only. */
  legacy_id?: string;
  /**
   * The test case document's permanent lifecycle — orthogonal to `skip` (a temporary,
   * execution-time block). active (default) / obsolete (no longer valid, e.g. a spec change) /
   * superseded (replaced by another case — see superseded_by). Keeping a permanently-unrunnable
   * case as `obsolete`/`superseded` rather than deleting it preserves the coverage decision;
   * a *temporary* block (e.g. "feature not released yet") belongs in `skip`, not here — folding
   * it into status risks it being forgotten once the blocker clears.
   */
  status?: "active" | "obsolete" | "superseded";
  /** status: obsolete/superseded — why it no longer applies. */
  reason?: string;
  /** status: superseded — id of the case that replaces this one. */
  superseded_by?: string;
  /** Verbatim marker from the migration source (e.g. "【SKIP】") when its intent couldn't be classified. */
  legacy_marker?: string;
  /** A temporary, execution-time block — the case itself stays active. */
  skip?: Skip;
  /** Free-form labels for attributes not worth a dedicated field (e.g. db_verup). */
  tags?: string[];
  /** manual (default) / automated / semi — automation state, orthogonal to status. */
  automation?: "manual" | "automated" | "semi";
  /** semi: what a person still checks by hand, since the automated part covers only some of the case */
  automation_note?: string;
  layer?: string;
  automation_reason?: string;
  _tcId?: string;
}

export interface LayerDefinition {
  label?: string;
  description?: string;
  automation?: "expected" | null;
}
export type Layers = Record<string, LayerDefinition>;

export function parseLayers(value: unknown, source: string): Layers {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid layers in ${source}: expected a mapping.`);
  for (const [name, raw] of Object.entries(value)) {
    if (!name.trim() || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Invalid layer "${name}" in ${source}.`);
    const rule = raw as Record<string, unknown>;
    for (const key of ["label", "description"]) if (rule[key] !== undefined && (typeof rule[key] !== "string" || !(rule[key] as string).trim())) throw new Error(`Invalid ${key} for layer "${name}" in ${source}: expected non-empty text.`);
    if (rule.automation !== undefined && rule.automation !== null && rule.automation !== "expected") throw new Error(`Invalid automation for layer "${name}" in ${source}.`);
  }
  return value as Layers;
}

export function loadLayers(file: string): Layers {
  return parseLayers(parse(readFileSync(file, "utf8")), file);
}

export function mergeLayers(base: Layers | undefined, overrides: Layers | undefined): Layers | undefined {
  if (!base && !overrides) return undefined;
  const merged: Layers = { ...base };
  for (const [key, rule] of Object.entries(overrides ?? {})) merged[key] = { ...merged[key], ...rule };
  return merged;
}

export interface Metadata {
  layers?: Layers;
  type_name: string;
  id_prefix: string;
  guides?: string[];
  category_order?: string[];
  /** Tags every test case in the suite inherits */
  tags?: string[];
  /** Reference numbers to link, as `{ pattern, url }` pairs; checked by parseAutolinkRules */
  autolinks?: unknown;
}

export interface TestCasesFileData {
  metadata: Metadata;
  test_cases?: TestCase[];
  parameterized_tests?: unknown[];
}

interface FormatConfig {
  key_labels?: Record<string, string>;
  value_labels?: Record<string, string>;
}

function formatObjectValue(obj: unknown, formatConfig: FormatConfig = {}): string {
  if (!obj || typeof obj !== "object") return String(obj);

  const { key_labels = {}, value_labels = {} } = formatConfig;
  const record = obj as Record<string, string>;

  const keys = Object.keys(key_labels);
  if (keys.length > 0 && keys.some((k) => k in record)) {
    const parts: string[] = [];
    for (const key of keys) {
      if (record[key]) {
        const keyLabel = key_labels[key] || key;
        const valueLabel = value_labels[record[key]] || record[key];
        parts.push(`${keyLabel}:${valueLabel}`);
      }
    }
    return parts.join(", ");
  }

  return JSON.stringify(obj);
}

function expandPlaceholders(template: unknown, params: Record<string, unknown>, formatConfig: FormatConfig = {}): string {
  if (typeof template !== "string") return String(template);
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    const placeholder = `{{${key}}}`;
    const replacement = typeof value === "object" && value !== null
      ? formatObjectValue(value, formatConfig)
      : String(value);
    result = result.replaceAll(placeholder, replacement);
  }
  return result;
}

function evaluateSingleCondition(condition: string, params: Record<string, unknown>): boolean {
  const match = condition.trim().match(/^(\w+)\s*(==|!=)\s*'([^']*)'$/);
  if (!match) return true;

  const [, paramName, operator, value] = match;
  const actualValue = String(params[paramName] ?? "");

  if (operator === "==") return actualValue === value;
  if (operator === "!=") return actualValue !== value;
  return true;
}

function evaluateWhen(whenExpr: string | undefined, params: Record<string, unknown>): boolean {
  if (!whenExpr) return true;

  if (whenExpr.includes("||")) {
    const orParts = whenExpr.split("||");
    return orParts.some((part) => evaluateWhen(part.trim(), params));
  }

  if (whenExpr.includes("&&")) {
    const andParts = whenExpr.split("&&");
    return andParts.every((part) => evaluateSingleCondition(part, params));
  }

  return evaluateSingleCondition(whenExpr, params);
}

/**
 * Concatenates tag lists, dropping repeats; undefined when there are none so untagged cases stay
 * untagged. A value that is not a list is passed through untouched for validateTags to reject.
 */
function mergeTags(...lists: unknown[]): string[] | undefined {
  const present = lists.filter((list) => list !== undefined && list !== null);
  const malformed = present.find((list) => !Array.isArray(list));
  if (malformed !== undefined) return malformed as string[];
  const unique = [...new Set(present.flat() as string[])];
  return unique.length > 0 ? unique : undefined;
}

const firstDefined = (...values: unknown[]): unknown => values.find((value) => value !== undefined && value !== null);

function expandParameterizedTests(parameterizedTests: unknown[]): TestCase[] {
  if (!parameterizedTests || parameterizedTests.length === 0) {
    return [];
  }

  const expandedCases: TestCase[] = [];

  for (const ptRaw of parameterizedTests) {
    const pt = ptRaw as Record<string, unknown>;
    const category = pt.category as string | undefined;
    const idPrefix = (pt.id_prefix as string | undefined) ?? "";
    const entryTags = pt.tags;
    const entryAutomation = pt.automation;
    const entryAutomationNote = pt.automation_note;
    const preconditions = pt.preconditions as unknown[] | undefined;
    const patterns = pt.patterns as Array<Record<string, unknown>>;
    const template = pt.template as Record<string, unknown>;
    const formatConfig = (pt.format as FormatConfig) || {};

    for (const pattern of patterns) {
      const { id, notes, tags: patternTags, automation, automation_note: automationNote, ...params } = pattern;
      const hasId = id !== undefined && id !== null;
      const tcId = hasId ? `${idPrefix}${id}` : idPrefix;
      const allParams = { ...params, ...(hasId ? { id } : {}), tc_id: tcId };

      const templateName = template.name as string | undefined;
      const name = templateName ? expandPlaceholders(templateName, allParams, formatConfig) : tcId;

      const steps: Step[] = [];
      const templateSteps = (template.steps as Array<Record<string, unknown>>) || [];
      for (const stepTemplate of templateSteps) {
        if (!evaluateWhen(stepTemplate.when as string | undefined, allParams)) {
          continue;
        }
        const action = expandPlaceholders(stepTemplate.action, allParams, formatConfig);
        const expected = expandPlaceholders(stepTemplate.expected, allParams, formatConfig);
        steps.push({ action, expected });
      }

      const postconditions = (template.postconditions as Array<Record<string, unknown>>) || [];
      for (const postTemplate of postconditions) {
        if (!evaluateWhen(postTemplate.when as string | undefined, allParams)) {
          continue;
        }
        if (steps.length > 0) {
          const text = expandPlaceholders(postTemplate.text, allParams, formatConfig);
          const lastStep = steps[steps.length - 1];
          if (lastStep.expected) {
            const prefix = lastStep.expected.startsWith("- ") ? "" : "- ";
            lastStep.expected = `${prefix}${lastStep.expected}\n- ${text}`;
          } else {
            lastStep.expected = `- ${text}`;
          }
        }
      }

      const note = firstDefined(automationNote, template.automation_note, entryAutomationNote);
      expandedCases.push({
        name,
        layer: firstDefined(pattern.layer, template.layer, pt.layer) as string | undefined,
        automation_reason: firstDefined(pattern.automation_reason, template.automation_reason, pt.automation_reason) as string | undefined,
        category,
        preconditions: preconditions || [],
        steps,
        notes: (notes as string) || null,
        id: hasId ? tcId : undefined,
        tags: mergeTags(entryTags, template.tags, patternTags),
        // Unlike tags these are one value each, so the most specific level that sets one wins
        automation: firstDefined(automation, template.automation, entryAutomation) as TestCase["automation"],
        automation_note: typeof note === "string" ? expandPlaceholders(note, allParams, formatConfig) : (note as undefined),
      });
    }
  }

  return expandedCases;
}

// Anchors flow verbatim into DOM element ids and #/ hash routes (see testCaseAnchorId in app.ts),
// so explicit ids are restricted to characters that are safe unencoded in both.
const VALID_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function assignTestCaseIds(testCases: TestCase[], idPrefix = "TC", sourceFile?: string): TestCase[] {
  const makeId = (index: number) => `${idPrefix}-${String(index + 1).padStart(3, "0")}`;

  const withIds = testCases.map((tc, index) => {
    if (tc.id === undefined || tc.id === null) {
      return { ...tc, _tcId: makeId(index) };
    }
    const explicitId = String(tc.id);
    if (!VALID_ID_PATTERN.test(explicitId)) {
      throw new Error(
        `Invalid test case id "${explicitId}"${sourceFile ? ` in ${sourceFile}` : ""}: ` +
          `only letters, digits, "-" and "_" are allowed (ids become DOM element ids and URL fragments).`,
      );
    }
    if (!explicitId.startsWith(`${idPrefix}-`)) {
      throw new Error(
        `Invalid test case id "${explicitId}"${sourceFile ? ` in ${sourceFile}` : ""}: ` +
          `explicit ids must start with "${idPrefix}-" (metadata.id_prefix) so they stay unique across suites.`,
      );
    }
    return { ...tc, _tcId: explicitId };
  });

  const seen = new Map<string, number>();
  withIds.forEach((tc, index) => {
    const firstIndex = seen.get(tc._tcId!);
    if (firstIndex !== undefined) {
      throw new Error(
        `Duplicate test case id "${tc._tcId}"${sourceFile ? ` in ${sourceFile}` : ""}: ` +
          `used by test cases at position ${firstIndex + 1} and ${index + 1}.`,
      );
    }
    seen.set(tc._tcId!, index);
  });

  return withIds;
}

function isTagList(value: unknown): boolean {
  return Array.isArray(value) && value.every((tag) => typeof tag === "string" && tag.trim() !== "");
}

const TAGS_HINT = `tags must be a list of non-empty strings (quote values like "2024" that YAML would read as numbers).`;

function validateTags(testCases: TestCase[], metadataTags: unknown, sourceFile: string): void {
  if (metadataTags !== undefined && metadataTags !== null && !isTagList(metadataTags)) {
    throw new Error(`Invalid metadata.tags in ${sourceFile}: ${TAGS_HINT}`);
  }
  for (const tc of testCases) {
    if (tc.tags === undefined || tc.tags === null) continue;
    if (!isTagList(tc.tags)) {
      throw new Error(`Invalid tags on test case "${tc.name}" in ${sourceFile}: ${TAGS_HINT}`);
    }
  }
}

const AUTOMATION_VALUES = ["manual", "automated", "semi"];

/**
 * A misspelt automation value would otherwise read as manual everywhere. A semi case's note says what is
 * left to a person, which is what whoever runs it needs; on any other case it has nothing to describe.
 */
function validateAutomation(testCases: TestCase[], sourceFile: string): void {
  for (const tc of testCases) {
    const label = tc.id ?? tc.name;
    if (tc.automation !== undefined && tc.automation !== null && !AUTOMATION_VALUES.includes(tc.automation)) {
      throw new Error(`Invalid automation "${String(tc.automation)}" on test case "${label}" in ${sourceFile}: use ${AUTOMATION_VALUES.join(", ")}.`);
    }
    const note = tc.automation_note;
    if (note !== undefined && note !== null && typeof note !== "string") {
      throw new Error(`Invalid automation_note on test case "${label}" in ${sourceFile}: it must be text.`);
    }
    const hasNote = typeof note === "string" && note.trim() !== "";
    if (tc.automation === "semi" && !hasNote) warn(`${label} is semi but has no automation_note saying what is checked by hand (${sourceFile})`);
    if (tc.automation !== "semi" && hasNote) warn(`${label} has an automation_note but is ${tc.automation ?? "manual"}, not semi (${sourceFile})`);
  }
}

function sortByCategoryOrder(testCases: TestCase[], categoryOrder: string[] | undefined): TestCase[] {
  if (!categoryOrder || categoryOrder.length === 0) {
    return testCases;
  }

  const orderMap = new Map(categoryOrder.map((cat, idx) => [cat, idx]));
  const maxOrder = categoryOrder.length;

  return [...testCases].sort((a, b) => {
    const catA = a.category || "Other";
    const catB = b.category || "Other";
    const orderA = orderMap.has(catA) ? orderMap.get(catA)! : maxOrder;
    const orderB = orderMap.has(catB) ? orderMap.get(catB)! : maxOrder;
    return orderA - orderB;
  });
}

export function groupByCategory(testCases: TestCase[]): Map<string, TestCase[]> {
  const grouped = new Map<string, TestCase[]>();
  for (const tc of testCases) {
    const category = tc.category || "Other";
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push(tc);
  }
  return grouped;
}

function loadGuides(guidePaths: string[]): string {
  if (!guidePaths || guidePaths.length === 0) {
    return "";
  }

  const contents: string[] = [];
  for (const guidePath of guidePaths) {
    if (existsSync(guidePath)) {
      const content = readFileSync(guidePath, "utf-8").trim();
      if (content) {
        contents.push(content);
      }
    } else {
      warn(`guide file not found: ${guidePath}`);
    }
  }

  return contents.join("\n\n---\n\n");
}

function validateMetadata(metadata: Metadata): string[] {
  const errors: string[] = [];
  if (!metadata?.type_name) {
    errors.push('metadata.type_name is required (e.g. "Login")');
  }
  if (!metadata?.id_prefix) {
    errors.push('metadata.id_prefix is required (e.g. "LOGIN")');
  }
  return errors;
}

export interface LoadedTestCases {
  metadata: Metadata;
  testCases: TestCase[];
  guideContent: string;
  /** The suite's valid autolink rules; a malformed one has already been reported and left out */
  autolinks: AutolinkRule[];
  /** Files to watch (the YAML itself plus any referenced guides) */
  watchFiles: string[];
}

/**
 * Loads testcases.yaml, expanding parameterized tests, assigning IDs, and sorting by section order.
 */
export function loadTestCases(yamlFile: string, projectLayers?: Layers): LoadedTestCases {
  const content = readFileSync(yamlFile, "utf-8");
  const yamlData = parse(content) as TestCasesFileData;

  const validationErrors = validateMetadata(yamlData.metadata);
  if (validationErrors.length > 0) {
    throw new Error(`Metadata error:\n${validationErrors.map((e) => `  - ${e}`).join("\n")}`);
  }

  const { id_prefix: idPrefix, guides } = yamlData.metadata;

  const watchFiles = [resolve(yamlFile)];
  let guideContent = "";
  if (guides && guides.length > 0) {
    const guidePaths = guides.map((g) => resolve(dirname(yamlFile), g));
    watchFiles.push(...guidePaths);
    guideContent = loadGuides(guidePaths);
  }

  const expandedCases = expandParameterizedTests(yamlData.parameterized_tests || []);
  const mergedCases = [...expandedCases, ...(yamlData.test_cases || [])];

  const categoryOrder = yamlData.metadata?.category_order;
  const sortedCases = sortByCategoryOrder(mergedCases, categoryOrder);
  validateTags(sortedCases, yamlData.metadata.tags, yamlFile);
  const suiteTags = yamlData.metadata.tags;
  const taggedCases = suiteTags ? sortedCases.map((tc) => ({ ...tc, tags: mergeTags(suiteTags, tc.tags) })) : sortedCases;
  const testCases = assignTestCaseIds(taggedCases, idPrefix, yamlFile);
  validateAutomation(testCases.map((tc) => ({ ...tc, id: tc._tcId })), yamlFile);

  const ownLayers = yamlData.metadata.layers === undefined ? undefined : parseLayers(yamlData.metadata.layers, yamlFile);
  const layers = mergeLayers(projectLayers, ownLayers);
  yamlData.metadata.layers = layers;
  for (const tc of testCases) {
    if (tc.layer !== undefined && (typeof tc.layer !== "string" || !tc.layer.trim())) throw new Error(`Invalid layer on ${tc._tcId} in ${yamlFile}: expected non-empty text.`);
    if (tc.automation_reason !== undefined && typeof tc.automation_reason !== "string") throw new Error(`Invalid automation_reason on ${tc._tcId} in ${yamlFile}.`);
    if (!layers) continue;
    if (!tc.layer || !Object.hasOwn(layers, tc.layer)) warn(`${tc._tcId} has ${tc.layer ? `undeclared layer "${tc.layer}"` : "no layer"} (${yamlFile})`);
    else if (layers[tc.layer].automation === "expected" && (!tc.status || tc.status === "active") && (tc.automation ?? "manual") === "manual" && !tc.automation_reason?.trim()) warn(`${tc._tcId} is manual in layer "${tc.layer}" where automation is expected; set automation_reason for an exception (${yamlFile})`);
  }

  const autolinks = parseAutolinkRules(yamlData.metadata.autolinks, `${yamlFile} (metadata)`);

  return { metadata: yamlData.metadata, testCases, guideContent, autolinks, watchFiles };
}

/**
 * Recursively finds every testcases.yaml under rootDir, skipping any whose path matches an
 * `exclude` glob (e.g. `**\/_template/**` to leave scaffolding out of the page).
 */
export async function findAllTestCaseFiles(rootDir: string, exclude: string[] = []): Promise<string[]> {
  const glob = new Bun.Glob("**/testcases.yaml");
  const excluded = exclude.map((pattern) => new Bun.Glob(pattern));
  const found: string[] = [];
  for await (const relativePath of glob.scan({ cwd: rootDir })) {
    // Matched relative to rootDir, so a pattern cannot accidentally hit a directory name
    // that only appears in the absolute path above the scan root
    const normalized = relativePath.replaceAll("\\", "/");
    if (excluded.some((pattern) => pattern.match(normalized))) continue;
    found.push(resolve(rootDir, relativePath));
  }
  return found.sort();
}

export interface TestSuiteTestCases extends LoadedTestCases {
  /** Source file path for this test suite (used for debugging and watch targeting) */
  sourceFile: string;
  /** Top-level directory name under rootDir (e.g. "web", "api"). The domain. */
  domain: string;
  /** Human-readable name from the domain directory's README.md heading. Falls back to domain. */
  domainLabel: string;
  /** Directory name under domain (e.g. "login"). The feature. A feature can have multiple test suites (testcases.yaml files). */
  feature: string;
  /** Human-readable name from the feature directory's README.md heading. Falls back to feature. */
  featureLabel: string;
}

/**
 * Extracts the "domain" and "feature" from the first two path segments of testcases.yaml relative to rootDir.
 * Example: web/login/basic/testcases.yaml
 *          -> domain="web", feature="login"
 * Missing segments are filled with an empty string.
 */
function extractDomainAndFeature(rootDir: string, yamlFile: string): { domain: string; feature: string } {
  const rel = resolve(yamlFile).slice(resolve(rootDir).length).replace(/^\/+/, "");
  const segments = rel.split("/");
  return { domain: segments[0] || "", feature: segments[1] || "" };
}

/** Reads the first "# Heading" from a directory's README.md. Returns null if absent. */
function readReadmeTitle(dir: string): string | null {
  const readmePath = resolve(dir, "README.md");
  if (!existsSync(readmePath)) return null;
  const content = readFileSync(readmePath, "utf-8");
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Loads every testcases.yaml under rootDir. A failure in one file is logged and skipped so it
 * doesn't prevent the other test suites from rendering.
 */
export async function loadAllTestSuites(rootDir: string, exclude: string[] = [], projectLayers?: Layers): Promise<TestSuiteTestCases[]> {
  const files = await findAllTestCaseFiles(rootDir, exclude);
  const results: TestSuiteTestCases[] = [];
  // Anchors and routes carry only the test case id, so it must be unique across the whole scan root
  const idOwners = new Map<string, string>();
  for (const file of files) {
    try {
      const loaded = loadTestCases(file, projectLayers);
      for (const tc of loaded.testCases) {
        const owner = idOwners.get(tc._tcId!);
        if (owner !== undefined) {
          throw new Error(`Duplicate test case id "${tc._tcId}": already used in ${owner}.`);
        }
      }
      for (const tc of loaded.testCases) idOwners.set(tc._tcId!, file);
      const { domain, feature } = extractDomainAndFeature(rootDir, file);
      const domainLabel = (domain && readReadmeTitle(resolve(rootDir, domain))) || domain;
      const featureLabel = (domain && feature && readReadmeTitle(resolve(rootDir, domain, feature))) || feature;
      results.push({ ...loaded, sourceFile: file, domain, domainLabel, feature, featureLabel });
    } catch (err) {
      warn(`failed to load ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return results;
}
