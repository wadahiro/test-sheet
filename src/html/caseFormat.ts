// Plain-text/Markdown renderings of a test case's preconditions and test data.
// Shared by the page (for copy and search) and by the generator (to render test data as HTML).

/** One precondition as text: a plain string as written, a mapping as `key: value` pairs */
export function preconditionText(precondition: unknown): string {
  if (typeof precondition === "object" && precondition !== null) {
    return Object.entries(precondition as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
  }
  return String(precondition);
}

export function formatPreconditions(preconditions: unknown[] | undefined): string {
  if (!preconditions || preconditions.length === 0) return "";
  return preconditions.map((p) => `- ${preconditionText(p)}`).join("\n");
}

function isObjectArray(arr: unknown[]): boolean {
  return arr.some((item) => typeof item === "object" && item !== null);
}

/**
 * Marks one value in the output. The page passes a marker so each value can get its own copy button;
 * `raw` is what gets copied and `shown` what the Markdown displays (a JSON dump is shown as code but
 * copied bare). The default leaves the text as it is, which is what Markdown copy and search want.
 */
export type ValueMarker = (raw: string, shown?: string) => string;

const plainValue: ValueMarker = (raw, shown) => shown ?? raw;

function formatArrayAsTable(dataArray: Array<Record<string, unknown>>, mark: ValueMarker): string {
  if (!dataArray || dataArray.length === 0) return "";
  const allKeys = new Set<string>();
  for (const item of dataArray) {
    for (const key of Object.keys(item)) allKeys.add(key);
  }
  const keys = Array.from(allKeys);
  if (keys.length === 0) return "";

  const headerRow = `| ${keys.join(" | ")} |`;
  const separatorRow = `|${keys.map(() => "---").join("|")}|`;
  const dataRows = dataArray.map((item) => {
    const values = keys.map((key) => {
      const value = item[key];
      if (value === undefined || value === null) return "";
      if (typeof value === "object") return mark(JSON.stringify(value));
      return mark(String(value));
    });
    return `| ${values.join(" | ")} |`;
  });
  return [headerRow, separatorRow, ...dataRows].join("\n");
}

export function formatTestData(testData: unknown, mark: ValueMarker = plainValue): string {
  if (!testData) return "";
  const lines: string[] = [];

  if (Array.isArray(testData)) {
    if (isObjectArray(testData)) {
      return formatArrayAsTable(testData as Array<Record<string, unknown>>, mark);
    }
    return testData.map((item) => mark(String(item))).join(", ");
  }

  for (const [key, value] of Object.entries(testData as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      if (isObjectArray(value)) {
        lines.push(`- **${key}:**`, "", formatArrayAsTable(value as Array<Record<string, unknown>>, mark), "");
      } else {
        lines.push(`- **${key}:** ${value.map((item) => mark(String(item))).join(", ")}`);
      }
    } else if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value as Record<string, unknown>);
      const allScalar = entries.every(([, v]) => typeof v !== "object" || v === null);
      if (allScalar) {
        lines.push(`- **${key}:**`);
        for (const [k, v] of entries) lines.push(`  - ${k}: ${mark(String(v))}`);
      } else {
        const json = JSON.stringify(value);
        lines.push(`- **${key}:** ${mark(json, `\`${json}\``)}`);
      }
    } else {
      lines.push(`- **${key}:** ${mark(String(value))}`);
    }
  }

  return lines.join("\n");
}
