import { describe, expect, test } from "bun:test"
import { pages } from "../src"

describe("page ranges", () => {
  test("normalizes, sorts, and deduplicates", () => expect(pages("8,1-3,2", 10)).toEqual([1, 2, 3, 8]))
  test("rejects invalid and out-of-bounds ranges", () => { expect(() => pages("3-1", 10)).toThrow(); expect(() => pages("11", 10)).toThrow() })
})
