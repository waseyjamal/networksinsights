// The safe-rendering rule for tool code (ADR 0050, docs/tool-contract.md "Rendering user text"):
// words a visitor typed or a file they opened reach the page as text, never as markup or code.
//
// React already escapes `{text}`, and the Content-Security-Policy refuses inline scripts, so the
// holes that are left are the few APIs that turn a string into HTML or code. This analyzer finds
// them in a tool's source. Like purity.ts it reads the syntax, not the types, so a comment or a
// string that mentions innerHTML is never reported; it lives in the web app because it needs the
// TypeScript compiler.

import ts from "typescript";

/** Properties that parse a string as HTML when assigned. */
const HTML_PROPERTIES = new Set(["innerHTML", "outerHTML", "srcdoc"]);

/** Methods that parse a string as HTML or run it as code, whatever object they are called on. */
const HTML_METHODS = new Set([
  "insertAdjacentHTML",
  "createContextualFragment",
  "setHTMLUnsafe",
  "parseHTMLUnsafe",
  "parseFromString",
]);

/** Globals that run a string as code, or build HTML from one. */
const CODE_GLOBALS = new Set(["eval", "Function", "DOMParser"]);

/** Timers that run a string argument as code. */
const TIMERS = new Set(["setTimeout", "setInterval"]);

/** JSX attributes that take markup or a URL a script could hide in. */
const JSX_HTML_ATTRIBUTES = new Set(["dangerouslySetInnerHTML", "srcDoc", "srcdoc"]);

const isStringy = (node: ts.Node | undefined) =>
  node !== undefined &&
  (ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node) ||
    (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken));

const isAssignment = (kind: ts.SyntaxKind) =>
  kind === ts.SyntaxKind.EqualsToken || kind === ts.SyntaxKind.PlusEqualsToken;

/** The name a call or `new` targets: `eval`, `document.write` gives `write` with its object. */
function calleeOf(expression: ts.Expression): { name: string; object?: string } | undefined {
  if (ts.isIdentifier(expression)) return { name: expression.text };
  if (ts.isPropertyAccessExpression(expression)) {
    const object = ts.isIdentifier(expression.expression) ? expression.expression.text : undefined;
    return object === undefined
      ? { name: expression.name.text }
      : { name: expression.name.text, object };
  }
  return undefined;
}

/**
 * Every way a tool source turns a string into markup or code, as sentences with a line number.
 * An empty array means the file is clean.
 */
export function checkSafeRendering(source: string, fileName: string): string[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, kind);
  const problems: string[] = [];
  const report = (node: ts.Node, what: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    problems.push(`line ${line + 1}: ${what}`);
  };

  const visit = (node: ts.Node) => {
    // element.innerHTML = value, frame.srcdoc = value
    if (
      ts.isBinaryExpression(node) &&
      isAssignment(node.operatorToken.kind) &&
      ts.isPropertyAccessExpression(node.left) &&
      HTML_PROPERTIES.has(node.left.name.text)
    ) {
      report(node, `assigns ${node.left.name.text}, which parses the string as HTML`);
    }
    // element["innerHTML"] = value
    if (
      ts.isBinaryExpression(node) &&
      isAssignment(node.operatorToken.kind) &&
      ts.isElementAccessExpression(node.left) &&
      ts.isStringLiteralLike(node.left.argumentExpression) &&
      HTML_PROPERTIES.has(node.left.argumentExpression.text)
    ) {
      report(node, `assigns ${node.left.argumentExpression.text}, which parses the string as HTML`);
    }

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = calleeOf(node.expression);
      const first = node.arguments?.[0];
      if (callee && HTML_METHODS.has(callee.name)) {
        report(node, `calls ${callee.name}(), which parses a string as HTML`);
      } else if (
        callee?.object === "document" &&
        (callee.name === "write" || callee.name === "writeln")
      ) {
        report(
          node,
          `calls document.${callee.name}(), which writes a string into the page as HTML`,
        );
      } else if (callee && callee.object === undefined && CODE_GLOBALS.has(callee.name)) {
        report(node, `uses ${callee.name}, which turns a string into code or markup`);
      } else if (callee && TIMERS.has(callee.name) && isStringy(first)) {
        report(node, `passes a string to ${callee.name}(), which runs it as code`);
      }
    }

    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(file);
      if (JSX_HTML_ATTRIBUTES.has(name)) {
        report(node, `sets ${name}, which renders a string as HTML`);
      }
      const value = node.initializer;
      const literal =
        value && ts.isStringLiteral(value)
          ? value.text
          : value &&
              ts.isJsxExpression(value) &&
              value.expression &&
              ts.isStringLiteralLike(value.expression)
            ? value.expression.text
            : undefined;
      if (literal !== undefined && /^\s*javascript:/i.test(literal)) {
        report(node, `sets ${name} to a javascript: URL`);
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(file);
  return problems;
}

/** The files of a tool folder the rule applies to: everything that runs. */
export const SAFE_RENDERING_FILES = ["ui.tsx", "logic.ts", "worker.ts"] as const;
