#!/usr/bin/env python3
"""One-time import of the Monday "2026 Lead Tracker" (board 18392764674) into
Supabase public.leads. Run AFTER the existing test leads have been deleted.

Pass one or more Monday GraphQL JSON dump files (saved by the Monday MCP) as
argv. Each file is either {boards:[{items_page:{items:[...]}}]} or
{next_items_page:{items:[...]}}. Supabase creds come from Website/.env.local.

Group -> stage mapping matches the Lynxedo pipeline. Lead Comments are imported
as the lead's note so they show as the latest note.
"""
import json, os, sys, urllib.request, urllib.error

HEROES_COMPANY_ID = "00000000-0000-0000-0000-000000000002"
ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env.local")

COLMAP = {
    "text_mm01h2aw": "first_name",
    "text_mm01ne1y": "last_name",
    "text_mkp4hekd": "phone",
    "text_mkp42w0x": "email",
    "dropdown_Mjj5nJ1I": "service",            # array
    "dropdown__1": "lead_source",
    "status__1": "status",
    "date1": "lead_creation_date",
    "date9": "sold_date",
    "numbers": "annual_value",
    "color_mkpjhknz": "salesperson",
    "dropdown_mkxe4k2k": "base_program_sold",
    "dropdown_mkxe7j80": "auxiliary_services",  # array
    # long_text_mkp4p5qf handled separately -> note
}
ARRAY_FIELDS = {"service", "auxiliary_services"}
DATE_FIELDS = {"lead_creation_date", "sold_date"}

GROUP_STAGE = {
    "Leads- Current": "current",
    "Appointment Set": "appointment_set",
    "Follow Up - Long Term": "follow_up_long_term",
    "Closed Won": "closed_won",
    "Upsells": "upsells",
    "Closed Lost": "closed_lost",
    "Closed Other": "closed_other",
    "Saves": "saves",
}


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


def items_from_file(path):
    d = json.load(open(path))
    if "boards" in d:
        return d["boards"][0]["items_page"]["items"]
    if "next_items_page" in d:
        return d["next_items_page"]["items"]
    raise ValueError(f"Unrecognized dump schema in {path}")


def transform(item):
    cmap = {cv["id"]: cv.get("text") for cv in item.get("column_values", [])}
    row = {
        "company_id": HEROES_COMPANY_ID,
        "stage": GROUP_STAGE.get((item.get("group") or {}).get("title", ""), "current"),
    }
    for cid, field in COLMAP.items():
        text = cmap.get(cid)
        if field in ARRAY_FIELDS:
            c = clean(text)
            row[field] = [s.strip() for s in c.split(",") if s.strip()] if c else None
        elif field == "annual_value":
            c = clean(text)
            try:
                row[field] = float(c.replace(",", "")) if c else None
            except ValueError:
                row[field] = None
        elif field in DATE_FIELDS:
            row[field] = clean(text)
        else:
            row[field] = clean(text)

    # Name fallback: if First/Last empty, split the Monday item name.
    if not row.get("first_name") and not row.get("last_name"):
        parts = (clean(item.get("name")) or "").split()
        if parts:
            row["first_name"] = parts[0]
            row["last_name"] = " ".join(parts[1:]) or None

    comment = clean(cmap.get("long_text_mkp4p5qf"))
    return row, comment


def post(url, key, path, rows, prefer):
    data = json.dumps(rows).encode()
    req = urllib.request.Request(f"{url}/rest/v1/{path}", data=data, method="POST")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", prefer)
    with urllib.request.urlopen(req) as r:
        body = r.read().decode()
        return r.status, json.loads(body) if body else None


def main():
    env = load_env(ENV_PATH)
    url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]

    items = []
    for p in sys.argv[1:]:
        items.extend(items_from_file(p))
    print(f"Loaded {len(items)} Monday items from {len(sys.argv) - 1} file(s)")

    pairs = [transform(it) for it in items]   # (row, comment)
    rows = [p[0] for p in pairs]

    stages = {}
    for r in rows:
        stages[r["stage"]] = stages.get(r["stage"], 0) + 1
    print("Stage counts:", stages)

    inserted_total = 0
    notes = []
    batch = 200
    for i in range(0, len(rows), batch):
        chunk_rows = rows[i:i + batch]
        chunk_comments = [c for _, c in pairs[i:i + batch]]
        try:
            status, returned = post(url, key, "leads", chunk_rows, "return=representation")
        except urllib.error.HTTPError as e:
            print(f"  leads batch {i}: HTTP {e.code} {e.read().decode()[:400]}")
            sys.exit(1)
        inserted_total += len(returned)
        for lead, comment in zip(returned, chunk_comments):
            if comment:
                notes.append({
                    "lead_id": lead["id"],
                    "company_id": HEROES_COMPANY_ID,
                    "note": comment,
                    "created_by": "Monday import",
                })
        print(f"  leads batch {i}-{i+batch}: HTTP {status}, inserted {len(returned)}")

    print(f"Inserted {inserted_total} leads. Notes to insert: {len(notes)}")
    for i in range(0, len(notes), batch):
        try:
            status, _ = post(url, key, "lead_notes", notes[i:i + batch], "return=minimal")
            print(f"  notes batch {i}-{i+batch}: HTTP {status}")
        except urllib.error.HTTPError as e:
            print(f"  notes batch {i}: HTTP {e.code} {e.read().decode()[:400]}")
            sys.exit(1)
    print("Leads import complete.")


if __name__ == "__main__":
    main()
