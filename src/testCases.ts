// Loading and normalizing logic for testcases.yaml.

import { readFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { parse } from "yaml";

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
  /** manual (default) / idweave / semi — automation state, orthogonal to status. */
  automation?: "manual" | "idweave" | "semi";
  /** Path to the idweave scenario.yaml when automation is idweave/semi. */
  scenario?: string;
  _tcId?: string;
}

export interface Metadata {
  type_name: string;
  id_prefix: string;
  guides?: string[];
  category_order?: string[];
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

function expandParameterizedTests(parameterizedTests: unknown[]): TestCase[] {
  if (!parameterizedTests || parameterizedTests.length === 0) {
    return [];
  }

  const expandedCases: TestCase[] = [];

  for (const ptRaw of parameterizedTests) {
    const pt = ptRaw as Record<string, unknown>;
    const category = pt.category as string | undefined;
    const idPrefix = (pt.id_prefix as string | undefined) ?? "";
    const preconditions = pt.preconditions as unknown[] | undefined;
    const patterns = pt.patterns as Array<Record<string, unknown>>;
    const template = pt.template as Record<string, unknown>;
    const formatConfig = (pt.format as FormatConfig) || {};

    for (const pattern of patterns) {
      const { id, notes, ...params } = pattern;
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

      expandedCases.push({
        name,
        category,
        preconditions: preconditions || [],
        steps,
        notes: (notes as string) || null,
        id: hasId ? tcId : undefined,
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
      console.error(`Warning: guide file not found: ${guidePath}`);
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
  /** Files to watch (the YAML itself plus any referenced guides) */
  watchFiles: string[];
}

/**
 * Loads testcases.yaml, expanding parameterized tests, assigning IDs, and sorting by section order.
 */
export function loadTestCases(yamlFile: string): LoadedTestCases {
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
  const testCases = assignTestCaseIds(sortedCases, idPrefix, yamlFile);

  return { metadata: yamlData.metadata, testCases, guideContent, watchFiles };
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
export async function loadAllTestSuites(rootDir: string, exclude: string[] = []): Promise<TestSuiteTestCases[]> {
  const files = await findAllTestCaseFiles(rootDir, exclude);
  const results: TestSuiteTestCases[] = [];
  // Anchors and routes carry only the test case id, so it must be unique across the whole scan root
  const idOwners = new Map<string, string>();
  for (const file of files) {
    try {
      const loaded = loadTestCases(file);
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
      console.error(`Warning: failed to load ${file}:`, err);
    }
  }
  return results;
}
