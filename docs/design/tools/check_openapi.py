"""Structural checks on the OpenAPI file. Not a substitute for a real linter."""
import re, sys, yaml
d = yaml.safe_load(open(sys.argv[1]))
errs = []
def resolve(r):
    cur = d
    for part in r.lstrip("#/").split("/"):
        cur = cur[part]
    return cur
def walk(n, path=""):
    if isinstance(n, dict):
        if "$ref" in n:
            try: resolve(n["$ref"])
            except Exception: errs.append(f"unresolved {n['$ref']} at {path}")
        if n.get("type") == "object" and "required" in n:
            for r in n["required"]:
                if r not in n.get("properties", {}): errs.append(f"required '{r}' not a property at {path}")
        for k, v in n.items(): walk(v, f"{path}/{k}")
    elif isinstance(n, list):
        for i, v in enumerate(n): walk(v, f"{path}/{i}")
walk(d)
ids = []
for p, item in d["paths"].items():
    for m, o in item.items():
        ids.append(o["operationId"])
        declared = {x["name"] for x in o.get("parameters", []) if x.get("in") == "path"}
        used = set(re.findall(r"\{(\w+)\}", p))
        if declared != used: errs.append(f"path params differ {m} {p}: {declared} vs {used}")
        if not o.get("responses"): errs.append(f"no responses {m} {p}")
        if not any(c.startswith("2") for c in o["responses"]): errs.append(f"no success response {m} {p}")
        for t in o["tags"]:
            if t not in [x["name"] for x in d["tags"]]: errs.append(f"unknown tag {t}")
        for sec in o.get("security", []):
            for k in sec:
                if k not in d["components"]["securitySchemes"]: errs.append(f"unknown scheme {k}")
        if m != "get" and o["x-role"] != "public" and o.get("security") != [{"sessionCookie": [], "csrfToken": []}]:
            errs.append(f"state-changing route without csrf {m} {p}")
        if o["x-role"] == "public" and o.get("security") != []: errs.append(f"public route with security {m} {p}")
if len(ids) != len(set(ids)): errs.append("duplicate operationId")
used = set(re.findall(r"#/components/schemas/(\w+)", open(sys.argv[1]).read()))
for s in d["components"]["schemas"]:
    if s not in used: errs.append(f"unused schema {s}")
print("\n".join(errs) or "ok", "|", len(d["paths"]), "paths", len(ids), "operations")
sys.exit(1 if errs else 0)
