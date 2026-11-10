import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadLayers, loadTestCases, mergeLayers, parseLayers } from "./testCases";
import { warningCount } from "./warnings";

describe("layer declarations", () => {
  test("overrides fields without losing labels or declaration order", () => {
    const base = parseLayers({ component: { label: "Internal", description: "Only the subject is real", automation: "expected" }, system: {} }, "project");
    const merged = mergeLayers(base, { component: { automation: null }, external: { label: "End to end" } });
    expect(Object.keys(merged!)).toEqual(["component", "system", "external"]);
    expect(merged!.component).toEqual({ label: "Internal", description: "Only the subject is real", automation: null });
    expect(base.component.automation).toBe("expected");
  });

  test("rejects malformed labels, descriptions and policies", () => {
    for (const value of [[], null, { component: { label: 2 } }, { component: { description: "" } }, { component: { automation: "required" } }]) {
      expect(() => parseLayers(value, "fixture")).toThrow();
    }
    expect(parseLayers({ component: { automation: null } }, "fixture")).toEqual({ component: { automation: null } });
  });

  test("loads a project mapping and checks policy after suite overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "sheet-layers-"));
    try {
      const project = join(dir, "layers.yaml");
      const suite = join(dir, "testcases.yaml");
      writeFileSync(project, 'component: {label: Internal, description: Subject only, automation: expected}\nsystem: {}\n');
      const layers = loadLayers(project);
      const data = 'metadata:\n  type_name: Fixture\n  id_prefix: FIX\n  layers:\n    component: {automation: null}\ntest_cases:\n  - name: Manual\n    layer: component\n    steps: []\n';
      writeFileSync(suite, data);
      const before = warningCount();
      const loaded = loadTestCases(suite, layers);
      expect(warningCount()).toBe(before);
      expect(loaded.metadata.layers!.component.label).toBe("Internal");
      expect(loaded.testCases[0].layer).toBe("component");
      writeFileSync(suite, data.replace('    component: {automation: null}', '    component: {}'));
      loadTestCases(suite, layers);
      expect(warningCount()).toBe(before + 1);
      writeFileSync(suite, data.replace('    component: {automation: null}', '    component: {label: Custom}'));
      expect(loadTestCases(suite, layers).metadata.layers!.component.label).toBe("Custom");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
