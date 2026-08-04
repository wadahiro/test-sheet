// Loading and normalizing logic for testcases.yaml.

import { readFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { parse } from "yaml";

export interface Step {
  action: string;
  expected: string;
}

export interface TestCase {
  name: string;
  category?: string;
  test_data?: unknown;
  preconditions?: unknown[];
  steps: Step[];
  notes?: string | null;
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
    const idPrefix = pt.id_prefix as string;
    const preconditions = pt.preconditions as unknown[] | undefined;
    const patterns = pt.patterns as Array<Record<string, unknown>>;
    const template = pt.template as Record<string, unknown>;
    const formatConfig = (pt.format as FormatConfig) || {};

    for (const pattern of patterns) {
      const { id, notes, ...params } = pattern;
      const tcId = `${idPrefix}${id}`;
      const allParams = { id: tcId, ...params };

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
      });
    }
  }

  return expandedCases;
}

function assignTestCaseIds(testCases: TestCase[], idPrefix = "TC"): TestCase[] {
  const makeId = (index: number) => `${idPrefix}-${String(index + 1).padStart(3, "0")}`;
  return testCases.map((tc, index) => ({ ...tc, _tcId: makeId(index) }));
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
  const testCases = assignTestCaseIds(sortedCases, idPrefix);

  return { metadata: yamlData.metadata, testCases, guideContent, watchFiles };
}

/**
 * Recursively finds every testcases.yaml under rootDir.
 */
export async function findAllTestCaseFiles(rootDir: string): Promise<string[]> {
  const glob = new Bun.Glob("**/testcases.yaml");
  const found: string[] = [];
  for await (const file of glob.scan({ cwd: rootDir, absolute: true })) {
    found.push(file);
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
export async function loadAllTestSuites(rootDir: string): Promise<TestSuiteTestCases[]> {
  const files = await findAllTestCaseFiles(rootDir);
  const results: TestSuiteTestCases[] = [];
  for (const file of files) {
    try {
      const loaded = loadTestCases(file);
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
