"""Structural checks over the generated Python SDK.

Reads a JSON object of {path: source} on stdin and writes a JSON report on stdout:

    {"syntax": [...], "unbound": [...]}

`syntax` holds files that do not parse at all. `unbound` holds the case that actually shipped:
a method whose signature is snake_cased while its f-string still interpolates the raw contract
name, so calling it raises `NameError`. `ast.parse` cannot see that — the file is valid Python,
it just refers to a name that does not exist — so every f-string is walked for the identifiers
it reads and each one is checked against the names bound in its enclosing function.
"""

# Deferred annotations so the `X | Y` unions below parse on macOS's system Python 3.9, which is
# what `python3` resolves to on a stock machine. The checker itself only needs the stdlib.
from __future__ import annotations

import ast
import builtins
import json
import sys
from typing import List, Set


def bound_names(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> Set[str]:
    """Every name the function body can legally read: its parameters plus its own assignments."""
    args = fn.args
    names = {a.arg for a in [*args.posonlyargs, *args.args, *args.kwonlyargs]}
    if args.vararg:
        names.add(args.vararg.arg)
    if args.kwarg:
        names.add(args.kwarg.arg)

    for node in ast.walk(fn):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            names.add(node.id)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                names.add(alias.asname or alias.name.split(".")[0])
    return names


def unbound_in_fstrings(tree: ast.Module, path: str) -> List[dict]:
    """Identifiers read inside an f-string that nothing in the enclosing function binds."""
    findings: List[dict] = []
    module_names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}
    module_names |= {
        alias.asname or alias.name.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in node.names
    }
    module_names |= {n.name for n in ast.walk(tree) if isinstance(n, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))}

    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        available = bound_names(fn) | module_names | set(dir(builtins))
        for joined in [n for n in ast.walk(fn) if isinstance(n, ast.JoinedStr)]:
            for name in [n for n in ast.walk(joined) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)]:
                if name.id not in available:
                    findings.append({"file": path, "function": fn.name, "name": name.id})
    return findings


def literal_templates(tree: ast.Module, path: str) -> List[dict]:
    """URLs passed to `_fetch` as a plain string that still carry a `{...}` placeholder.

    The sibling of the unbound-name case, and invisible to it: when the placeholder is not a valid
    Python identifier the generator emits no f-string at all, so the braces travel to the server
    verbatim instead of raising anything.
    """
    findings: List[dict] = []
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for call in [n for n in ast.walk(fn) if isinstance(n, ast.Call)]:
            func = call.func
            if not (isinstance(func, ast.Attribute) and func.attr.startswith("_fetch")):
                continue
            if not call.args:
                continue
            url = call.args[0]
            if isinstance(url, ast.Constant) and isinstance(url.value, str) and "{" in url.value:
                findings.append({"file": path, "function": fn.name, "url": url.value})
    return findings


def main() -> None:
    sources = json.load(sys.stdin)
    syntax, unbound, literal = [], [], []

    for path, source in sorted(sources.items()):
        try:
            tree = ast.parse(source, filename=path)
        except SyntaxError as exc:
            syntax.append({"file": path, "message": f"{exc.msg} (line {exc.lineno})"})
            continue
        unbound.extend(unbound_in_fstrings(tree, path))
        literal.extend(literal_templates(tree, path))

    json.dump({"syntax": syntax, "unbound": unbound, "literal": literal}, sys.stdout)


main()
