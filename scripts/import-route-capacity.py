#!/usr/bin/env python3
"""One-time import of the Monday "Route Capacity" board (board 18408768408) into
Supabase public.route_capacity. Pass the Monday GraphQL dump file(s) as argv.
Idempotent on monday_item_id (existing rows ignored). Formula columns are
computed in the app, not imported.
"""
import json, os, sys, urllib.request, urllib.error

HEROES_COMPANY_ID = "00000000-0000-0000-0000-000000000002"
ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env.local")

COLMAP = {
    "date_mm2epmg3": "sync_date",
    "text_mm2e9h3k": "job_title",
    "text_mm2e37x7": "client_name",
    "text_mm2ejb49": "service_street",
    "text_mm2exx8d": "service_city",
    "text_mm2e8c71": "service_province",
    "text_mm2ma0q1": "service_zip",
    "text_mm2edd00": "line_items",
    "numeric_mm2ebvsy": "total",
    "text_mm2evevg": "lawn_size",
    "text_mm2esdfj": "size_helper",
    "numeric_mm2gm1mw": "drive_time",
}
NUM_FIELDS = {"total", "drive_time"}
DATE_FIELDS = {"sync_date"}


def load_env(path):
    env = {}
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def clean(v):
    if v is None:
        return None
    v = v.strip()
    return v if v else None


def items_from_file(path):
    d = json.load(open(path))
    if "boards" in d:
        return d["boards"][0]["items_page"]["items"]
    if "next_items_page" in d:
        return d["next_items_page"]["items"]
    raise ValueError(f"Unrecognized schema in {path}")


def transform(item):
    cmap = {cv["id"]: cv.get("text") for cv in item.get("column_values", [])}
    row = {
        "company_id": HEROES_COMPANY_ID,
        "source": "monday",
        "monday_item_id": str(item["id"]),
        "monday_group": (item.get("group") or {}).get("title"),
        "name": clean(item.get("name")),
    }
    for cid, field in COLMAP.items():
        text = cmap.get(cid)
        if field in NUM_FIELDS:
            c = clean(text)
            try:
                row[field] = float(c.replace(",", "")) if c else None
            except ValueError:
                row[field] = None
        elif field in DATE_FIELDS:
            row[field] = clean(text)
        else:
            row[field] = clean(text)
    return row


def post(url, key, rows):
    endpoint = f"{url}/rest/v1/route_capacity?on_conflict=monday_item_id"
    req = urllib.request.Request(endpoint, data=json.dumps(rows).encode(), method="POST")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "resolution=ignore-duplicates,return=minimal")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, ""
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:500]


def main():
    env = load_env(ENV_PATH)
    url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]

    items = []
    for p in sys.argv[1:]:
        items.extend(items_from_file(p))
    rows = [transform(it) for it in items]
    print(f"Transformed {len(rows)} rows. Sample: {json.dumps(rows[0])[:400]}")
    groups = {}
    for r in rows:
        groups[r["monday_group"]] = groups.get(r["monday_group"], 0) + 1
    print("Group counts:", groups)

    batch = 200
    for i in range(0, len(rows), batch):
        status, err = post(url, key, rows[i:i + batch])
        print(f"  batch {i}-{i+batch}: HTTP {status} {err}")
        if status >= 300:
            sys.exit(1)
    print("Route Capacity import complete.")


if __name__ == "__main__":
    main()
