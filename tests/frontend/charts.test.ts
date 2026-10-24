import { describe, expect, it } from "vitest";
import {
  chartDomain,
  hasData,
  GUEST_CHARTS,
  NODE_CHARTS,
  seriesValues,
} from "../../src/frontend/components/RrdCharts";
import locales from "../../locales/en.json";

const points = [
  { time: 1, cpu: 0.25, mem: 512 },
  { time: 2, cpu: 0.5 },
  { time: 3, cpu: Number.NaN, mem: 1024 },
];

describe("rrd charts", () => {
  it("turns CPU shares into percent and gaps into null", () => {
    expect(seriesValues(points, "cpu", "percent")).toEqual([25, 50, null]);
    expect(seriesValues(points, "mem", "bytes")).toEqual([512, null, 1024]);
  });

  it("scales the axis to the data", () => {
    expect(chartDomain([10, 90], "percent")).toEqual([0, 100]);
    expect(chartDomain([0, 1000, null], "bytes")).toEqual([0, 1100]);
    expect(chartDomain([null], "rate")).toEqual([0, 1024]);
    expect(chartDomain([0, 0], "plain")).toEqual([0, 1]);
  });

  it("knows when there is nothing to draw", () => {
    expect(hasData([null, null])).toBe(false);
    expect(hasData([null, 0])).toBe(true);
  });

  it("names every series with a string that exists", () => {
    const lookup = (key: string) =>
      key
        .split(".")
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)?.[part],
          locales,
        );
    for (const spec of [...NODE_CHARTS, ...GUEST_CHARTS]) {
      expect(lookup(spec.titleKey)).toBeTypeOf("string");
      for (const series of spec.series)
        expect(lookup(series.labelKey)).toBeTypeOf("string");
    }
  });
});
