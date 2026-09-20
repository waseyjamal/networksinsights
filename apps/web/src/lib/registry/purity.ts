// Enforces the purity rule of logic.ts: pure TypeScript, no UI, no network, no side effects on
// import, and nothing that only exists in one of the three runtimes (ADR 0031, ADR 0033).
//
// The rules — which globals and which packages are allowed — live in the SDK, in one place. This
// file is only the analyzer, and it lives in the web app because it needs the TypeScript compiler,
// which the SDK deliberately does not depend on.
//
// It reads the syntax, not the types: a name used in value position that nothing in the file
// declares is a global. Treating every name declared anywhere in the file as declared means a
// local that shadows a banned global is not reported. That direction is the safe one — it never
// fails a build over something harmless.

import {
  ALLOWED_GLOBALS,
  ALLOWED_IMPORTS,
  BANNED_GLOBALS,
  BANNED_IMPORT_EXTENSIONS,
} from "@networksinsights/tool-sdk";
import ts from "typescript";

const allowedGlobals = new Set(ALLOWED_GLOBALS);
const allowedImports = new Set(ALLOWED_IMPORTS);

/** `zod` also covers `zod/v4`, but never `zod-extra`. */
function isAllowedPackage(specifier: string): boolean {
  if (allowedImports.has(specifier)) return true;
  return [...allowedImports].some((allowed) => specifier.startsWith(`${allowed}/`));
}

function collectDeclaredNames(source: ts.SourceFile): Set<string> {
  const declared = new Set<string>();
  const addBinding = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) {
      declared.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) addBinding(element.name);
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportClause(node) && node.name) declared.add(node.name.text);
    if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) declared.add(node.name.text);
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) addBinding(node.name);
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      addBinding(node.variableDeclaration.name);
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassExpression(node)) &&
      node.name
    ) {
      declared.add(node.name.text);
    }
    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      declared.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return declared;
}

/** True when the identifier names a type, a property or a declaration rather than a value. */
function isNotAValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) return true;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return true;
  if (ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) {
    if (parent.name === node) return true;
  }

  // Anything inside a type: `const x: Uint8Array` names a type, not a value.
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isTypeNode(current) || ts.isTypeParameterDeclaration(current)) return true;
    if (ts.isInterfaceDeclaration(current) || ts.isTypeAliasDeclaration(current)) return true;
    if (ts.isSourceFile(current)) break;
  }
  return false;
}

/** The declarations a module may have at the top level: things, never actions. */
function isDeclarationStatement(statement: ts.Statement): boolean {
  return (
    ts.isImportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isExportAssignment(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement) ||
    ts.isVariableStatement(statement) ||
    ts.isEmptyStatement(statement)
  );
}

function describeStatement(statement: ts.Statement): string {
  if (ts.isExpressionStatement(statement)) return "an expression statement";
  if (ts.isIfStatement(statement)) return "an if statement";
  if (ts.isTryStatement(statement)) return "a try statement";
  if (
    ts.isForStatement(statement) ||
    ts.isForOfStatement(statement) ||
    ts.isForInStatement(statement)
  ) {
    return "a loop";
  }
  if (ts.isWhileStatement(statement) || ts.isDoStatement(statement)) return "a loop";
  if (ts.isSwitchStatement(statement)) return "a switch statement";
  if (ts.isThrowStatement(statement)) return "a throw statement";
  if (ts.isBlock(statement)) return "a block";
  return "a statement";
}

/** True when the node sits directly in the module body, not inside a function. */
function isAtTopLevel(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessor(current) ||
      ts.isSetAccessor(current) ||
      ts.isConstructorDeclaration(current)
    ) {
      return false;
    }
    if (ts.isSourceFile(current)) return true;
  }
  return true;
}

/**
 * Every way a logic.ts breaks the purity rule, as sentences. An empty array means it is pure.
 */
export function checkLogicPurity(source: string, fileName = "logic.ts"): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const problems: string[] = [];
  const declared = collectDeclaredNames(file);
  const seenGlobals = new Set<string>();

  for (const statement of file.statements) {
    if (!isDeclarationStatement(statement)) {
      problems.push(
        `has ${describeStatement(statement)} at the top level: importing logic.ts must do nothing, so it may only declare things`,
      );
    }
  }

  const checkSpecifier = (specifier: ts.Expression | undefined) => {
    if (!specifier || !ts.isStringLiteral(specifier)) return;
    const value = specifier.text;
    if (value.startsWith(".")) {
      if (value.includes("..")) {
        problems.push(
          `imports "${value}": a tool may only import files from inside its own folder`,
        );
      }
      const banned = BANNED_IMPORT_EXTENSIONS.find((extension) => value.endsWith(extension));
      if (banned) {
        problems.push(`imports "${value}": a ${banned} file is UI or content, not logic`);
      }
      return;
    }
    if (!isAllowedPackage(value)) {
      problems.push(
        `imports "${value}", which is not on the allowed list (${ALLOWED_IMPORTS.join(", ")}): adding a library takes an ADR stating its license, size and why`,
      );
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      checkSpecifier(node.moduleSpecifier);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      problems.push(
        "uses a dynamic import(): logic.ts is loaded as one module, in every runtime, with no surprises",
      );
    }
    if (ts.isAwaitExpression(node) && isAtTopLevel(node)) {
      problems.push("awaits at the top level: importing logic.ts must do nothing");
    }
    if (ts.isIdentifier(node) && !isNotAValueReference(node) && !declared.has(node.text)) {
      const name = node.text;
      if (!seenGlobals.has(name)) {
        seenGlobals.add(name);
        const banned = BANNED_GLOBALS[name];
        if (banned) {
          problems.push(`uses \`${name}\`: ${banned}`);
        } else if (!allowedGlobals.has(name)) {
          problems.push(
            `uses the global \`${name}\`, which is not one of the web APIs a browser, a Web Worker and a server all have`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  return problems;
}
