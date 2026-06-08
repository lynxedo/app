#!/usr/bin/env python3
"""One-time import of the Monday "Recurring Services" board (board 18188676554)
into Supabase public.recurring_services. Idempotent on monday_item_id.

Reads the Monday GraphQL JSON dump (saved by the Monday MCP) passed as argv[1],
and Supabase creds from Website/.env.local. Inserts via Supabase REST using the
service-role key (bypasses RLS). Re-runnable: existing monday_item_id rows are
ignored, never overwritten.
"""
import json, os, sys, urllib.request, urllib.error

HEROES_COMPANY_ID = "00000000-0000-0000-0000-000000000002"
ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env.local")

# Monday column id -> our field
COLMAP = {
    "text_mkp4hekd": "phone",
    "text_mkp42w0x": "email",
    "long_text_mkp4p5qf": "lead_comments",
    "dropdown_Mjj5nJ1I": "service",            # multi -> array
    "dropdown__1": "lead_source",              # single text
    "status__1": "status",
    "date1": "lead_creation_date",
    "numbers": "annual_value",
    "date9": "sold_date",
    "color_mkpjhknz": "salesperson",
    "dropdown_mkwr5ny9": "base_program_sold",  # single text
    "dropdown_mkwrfsf6": "auxiliary_services", # multi -> array
    "color_mkwrfe52": "cancelled_status",
    "dropdown_mkwrp11g": "cancellation_reason",
    "date_mkwrmp6c": "cancel_date",
    "boolean_mkyrg3ce": "temp_updated",
    "boolean_mkyrg5r2": "temp_prepaid",
}
ARRAY_FIELDS = {"service", "auxiliary_services"}
DATE_FIELDS = {"lead_creation_date", "sold_date", "cancel_date"}
BOOL_FIELDS = {"temp_updated", "temp_prepaid"}


def load_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def clean(v):
    if v is None:
        return None
    v = v.strip()
    return v if v else None


def transform(item):
    row = {
        "company_id": HEROES_COMPANY_ID,
        "source": "monday",
        "monday_item_id": str(item["id"]),
        "monday_group": (item.get("group") or {}).get("title"),
        "name": clean(item.get("name")),
    }
    for cv in item.get("column_values", []):
        field = COLMAP.get(cv["id"])
        if not field:
            continue
        text = cv.get("text")
        if field in BOOL_FIELDS:
            row[field] = bool(text) and text.strip().lower() in ("v", "true", "1", "checked", "yes")
        elif field in ARRAY_FIELDS:
            c = clean(text)
            row[field] = [s.strip() for s in c.split(",") if s.strip()] if c else None
        elif field == "annual_value":
            c = clean(text)
            try:
                row[field] = float(c.replace(",", "")) if c else None
            except ValueError:
                row[field] = None
        elif field in DATE_FIELDS:
            row[field] = clean(text)  # already YYYY-MM-DD or None
        else:
            row[field] = clean(text)
    return row


def post_batch(url, key, rows):
    endpoint = f"{url}/rest/v1/recurring_services?on_conflict=monday_item_id"
    data = json.dumps(rows).encode()
    req = urllib.request.Request(endpoint, data=data, method="POST")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    # ignore-duplicates = never clobber an existing monday_item_id row
    req.add_header("Prefer", "resolution=ignore-duplicates,return=minimal")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, ""
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:500]


def main():
    dump_path = sys.argv[1]
    env = load_env(ENV_PATH)
    url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]

    data = json.load(open(dump_path))
    items = data["boards"][0]["items_page"]["items"]
    rows = [transform(it) for it in items]
    print(f"Transformed {len(rows)} rows. Sample: {json.dumps(rows[0])[:400]}")

    groups = {}
    for r in rows:
        groups[r["monday_group"]] = groups.get(r["monday_group"], 0) + 1
    print("Group counts:", groups)

    batch = 200
    for i in range(0, len(rows), batch):
        status, err = post_batch(url, key, rows[i:i + batch])
        print(f"  batch {i}-{i+batch}: HTTP {status} {err}")
        if status >= 300:
            print("ABORTING on error")
            sys.exit(1)
    print("Import POST complete.")


if __name__ == "__main__":
    main()
