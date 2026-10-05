import * as sqlFormatter from "sql-formatter";
import { describe, expect, it } from "vitest";
import {
  DIALECT_KEYS,
  DIALECTS,
  finish,
  formatSql,
  type Input,
  LIMITS,
  locate,
  MESSAGES,
  measure,
  offsetOf,
  precheck,
} from "./logic";

// The tests hand formatSql() the same `sql-formatter` library worker.ts loads, so they check real
// output.

const format = (text: string, extra: Partial<Input> = {}) =>
  finish(
    text,
    formatSql(sqlFormatter, { text, dialect: "sql", keywordCase: "upper", indent: "2", ...extra }),
  );

const EXAMPLE =
  "select u.name, count(o.id) as orders from users u left join orders o on o.user_id = u.id where u.active = 1 group by u.name order by orders desc;";

describe("dialects", () => {
  it("offers every dialect the library supports, once each", () => {
    const library = sqlFormatter.supportedDialects.filter((key) => key !== "tsql");
    expect([...DIALECT_KEYS].sort()).toEqual([...library].sort());
    expect(DIALECT_KEYS).toHaveLength(20);
    expect(DIALECT_KEYS[0]).toBe("sql");
  });

  it("formats a simple query in every dialect", () => {
    for (const dialect of DIALECT_KEYS) {
      expect(
        format("select a, b from t where a = 1", { dialect }),
        DIALECTS[dialect],
      ).toMatchObject({
        ok: true,
        output: "SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  a = 1\n",
      });
    }
  });
});

describe("precheck", () => {
  it("asks for text when there is none", () => {
    expect(precheck("\n ")).toEqual({ ok: false, reason: "empty", error: MESSAGES.empty });
  });

  it("accepts exactly 200,000 characters and refuses one more", () => {
    expect(LIMITS.maxCharacters).toBe(200_000);
    expect(precheck("a".repeat(200_000))).toBeNull();
    expect(precheck("a".repeat(200_001))).toEqual({
      ok: false,
      reason: "tooLong",
      error: "This text is longer than 200,000 characters. Split it into smaller parts.",
    });
  });
});

describe("formatSql", () => {
  it("formats the page example in upper case with 2 spaces", () => {
    expect(format(EXAMPLE)).toEqual({
      ok: true,
      output:
        "SELECT\n  u.name,\n  COUNT(o.id) AS orders\nFROM\n  users u\n  LEFT JOIN orders o ON o.user_id = u.id\nWHERE\n  u.active = 1\nGROUP BY\n  u.name\nORDER BY\n  orders DESC;\n",
      lines: 12,
      characters: 160,
    });
  });

  it("writes keywords in lower case or as written, and indents with 4 spaces or tabs", () => {
    expect(format("SELECT a FROM t", { keywordCase: "lower", indent: "4" })).toMatchObject({
      output: "select\n    a\nfrom\n    t\n",
    });
    expect(format("Select a From t", { keywordCase: "preserve", indent: "tab" })).toMatchObject({
      output: "Select\n\ta\nFrom\n\tt\n",
    });
  });

  it("keeps a CREATE TABLE column list on one line, and a word it does not know as written", () => {
    expect(format("create table t (id int primary key, name varchar(20))")).toMatchObject({
      output: "CREATE TABLE t (id INT PRIMARY key, name VARCHAR(20))\n",
    });
  });

  it("puts a blank line between statements", () => {
    expect(format("select 1; select 2;")).toMatchObject({
      output: "SELECT\n  1;\n\nSELECT\n  2;\n",
    });
  });

  it("keeps strings, comments and quoted names as written", () => {
    expect(
      format("select `Name` from t -- who\nwhere x = 'Select'", { dialect: "mysql" }),
    ).toMatchObject({
      output: "SELECT\n  `Name`\nFROM\n  t -- who\nWHERE\n  x = 'Select'\n",
    });
  });

  it("names the line and column where a dialect cannot read the SQL", () => {
    const result = format("select `a` from t", { dialect: "postgresql" });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      error: `Line 1, column 8: ${MESSAGES.unreadable("PostgreSQL")}`,
      at: { line: 1, column: 8, pointer: "select `a` from t\n       ^" },
    });
    expect(format("select a\nfrom t\nwhere x = 'open", { dialect: "sqlite" })).toMatchObject({
      ok: false,
      error: `Line 3, column 11: ${MESSAGES.unreadable("SQLite")}`,
    });
  });

  it("shows a failure without a position as a plain message", () => {
    const broken = {
      format: () => {
        throw new Error("boom");
      },
    };
    expect(
      finish(
        "x",
        formatSql(broken, { text: "x", dialect: "sql", keywordCase: "upper", indent: "2" }),
      ),
    ).toEqual({
      ok: false,
      reason: "failed",
      error: MESSAGES.failed,
    });
  });
});

describe("helpers", () => {
  it("turns a line and column from a message into an offset", () => {
    expect(offsetOf("ab\ncde", "Parse error at line 2 column 3.")).toBe(5);
    expect(offsetOf("ab", "no position")).toBeNull();
    expect(offsetOf("ab", "at line 5 column 1")).toBeNull();
  });

  it("locates an offset, and counts lines without the final line break", () => {
    expect(locate("ab\ncd", 4)).toEqual({ line: 2, column: 2, pointer: "cd\n ^" });
    expect(measure("a\nb\n")).toEqual({ lines: 2, characters: 4 });
  });
});
