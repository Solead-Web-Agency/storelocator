#!/usr/bin/env python3
"""
build_data.py — Convertit l'export CSV des points de vente PCS en data/stores.json
(format compact chargé par le store locator).

Usage :
    python3 scripts/build_data.py                      # prend le dernier "PCS_liste store_*.csv" à la racine
    python3 scripts/build_data.py chemin/vers/fichier.csv

Format de sortie :
    {
      "generated": "2026-09-09",
      "source": "PCS_liste store_20260907.csv",
      "count": 28410,
      "types": {"1": "Recharge", "2": "Recharge, Vente de carte"},
      "stores": [[id, type, adresse, code_postal, ville, lng, lat], ...]
    }
"""
import csv
import datetime
import glob
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "stores.json"

TYPES = {"1": "Recharge", "2": "Recharge, Vente de carte"}

# Mots qui restent en minuscules dans un nom de lieu (sauf en début de chaîne)
SMALL = {"de", "du", "des", "la", "le", "les", "et", "en", "sur", "sous", "au", "aux",
         "à", "a", "lès", "près", "pres", "d", "l"}
# Sigles à garder en majuscules
ABBR = {"zac", "zi", "za", "zae", "cc", "ccial", "rn", "rd", "cd", "bp", "hlm", "cv"}
ROMAN = re.compile(r"^(?:x{0,3})(?:ix|iv|v?i{0,3})$")
ORDINAL = re.compile(r"^\d+(?:er|ere|ère|eme|ème|e|bis|ter|quater)$")
NUM_LETTER = re.compile(r"^\d+[a-z]$")


def _cap(word, first):
    """Capitalise un mot en gérant l'apostrophe (l'Aven, d'Hérouville)."""
    if not word:
        return word
    if word in ABBR:
        return word.upper()
    if ROMAN.match(word) and word:
        return word.upper()
    if word[0].isdigit():
        if NUM_LETTER.match(word):
            return word.upper()
        return word  # 1er, 2bis, 12
    if "'" in word:
        head, _, tail = word.partition("'")
        head = head.capitalize() if first else head
        return f"{head}'{_cap(tail, True)}"
    if word in SMALL and not first:
        return word
    return word[0].upper() + word[1:]


def title_fr(s):
    s = re.sub(r"\s+", " ", (s or "").strip().lower())
    if not s:
        return ""
    tokens = re.split(r"([ \-/])", s)
    out, first = [], True
    for tok in tokens:
        if tok in (" ", "-", "/"):
            out.append(tok)
            continue
        out.append(_cap(tok, first))
        first = False
    return "".join(out)


def clean_address(a):
    a = re.sub(r"\s+", " ", (a or "").strip())
    a = re.sub(r"^0+\s+", "", a)          # "0 GALERIE MARCHANDE" -> pas de numéro
    return title_fr(a)


def main():
    if len(sys.argv) > 1:
        src = Path(sys.argv[1])
    else:
        cands = sorted(glob.glob(str(ROOT / "PCS_liste store_*.csv")))
        if not cands:
            sys.exit("Aucun fichier 'PCS_liste store_*.csv' trouvé à la racine. Passe le chemin en argument.")
        src = Path(cands[-1])
    print(f"Source : {src.name}")

    stores, skipped = [], {"header_dup": 0, "no_coords": 0, "bad_coords": 0, "bad_id": 0}
    with open(src, encoding="utf-8", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            if (r.get("ID") or "").strip() == "ID":
                skipped["header_dup"] += 1
                continue
            sid = (r.get("ID") or "").strip()
            if not sid.isdigit():
                skipped["bad_id"] += 1
                continue
            lng, lat = (r.get("Longitude") or "").strip(), (r.get("Latitude") or "").strip()
            if not lng or not lat:
                skipped["no_coords"] += 1
                print(f"  ! sans coordonnées : #{sid} {r.get('Adresse')} {r.get('Code postal')} {r.get('Ville')}")
                continue
            try:
                lng, lat = float(lng), float(lat)
                if not (-180 <= lng <= 180 and -90 <= lat <= 90) or (lng == 0 and lat == 0):
                    raise ValueError
            except ValueError:
                skipped["bad_coords"] += 1
                continue
            infos = (r.get("Infos") or "").strip().lower()
            typ = 2 if infos.startswith("cartes") else 1
            stores.append([
                int(sid),
                typ,
                clean_address(r.get("Adresse")),
                (r.get("Code postal") or "").strip(),
                title_fr(r.get("Ville")),
                round(lng, 5),
                round(lat, 5),
            ])

    stores.sort(key=lambda s: (s[3], s[2]))
    payload = {
        "generated": datetime.date.today().isoformat(),
        "source": src.name,
        "count": len(stores),
        "types": TYPES,
        "stores": stores,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    n2 = sum(1 for s in stores if s[1] == 2)
    print(f"-> {OUT.relative_to(ROOT)} : {len(stores)} points de vente "
          f"({len(stores) - n2} recharge, {n2} cartes + recharge), {OUT.stat().st_size / 1e6:.2f} Mo")
    print(f"   ignorés : {skipped}")


if __name__ == "__main__":
    main()
