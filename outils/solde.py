#!/usr/bin/env python3
"""Solde du compte DeepSeek (GET /user/balance).

La clé d'API est lue dans l'environnement (`DEEPSEEK_API_KEY`) ou, à défaut,
dans `~/.config/goose/secrets.yaml`. Elle n'est **jamais** écrite dans les
fichiers publiés : seuls les montants le sont.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

ENDPOINT = "https://api.deepseek.com/user/balance"
SECRETS_GOOSE = Path.home() / ".config" / "goose" / "secrets.yaml"


def cle_api() -> str | None:
    """Clé d'API DeepSeek, ou None si introuvable."""
    cle = os.environ.get("DEEPSEEK_API_KEY")
    if cle:
        return cle.strip()
    if SECRETS_GOOSE.exists():
        for ligne in SECRETS_GOOSE.read_text(encoding="utf-8").splitlines():
            if ligne.strip().startswith("DEEPSEEK_API_KEY:"):
                return ligne.split(":", 1)[1].strip().strip("'\"") or None
    return None


def recuperer(cle: str | None = None, timeout: float = 15.0) -> dict | None:
    """Solde courant, ou None si la clé manque ou l'appel échoue."""
    jeton = cle or cle_api()
    if not jeton:
        return None
    requete = urllib.request.Request(
        ENDPOINT,
        headers={"Authorization": f"Bearer {jeton}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(requete, timeout=timeout) as reponse:
            donnees = json.loads(reponse.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
        return None

    infos = donnees.get("balance_infos") or [{}]
    principal = infos[0]
    try:
        total = float(principal.get("total_balance", 0))
        recharge = float(principal.get("topped_up_balance", 0))
        offert = float(principal.get("granted_balance", 0))
    except (TypeError, ValueError):
        total = recharge = offert = 0.0
    return {
        "disponible": bool(donnees.get("is_available")),
        "devise": principal.get("currency", "USD"),
        "total": total,
        "offert": offert,
        "recharge": recharge,
        "toutes_devises": infos,
    }


if __name__ == "__main__":
    print(json.dumps(recuperer() or {"erreur": "solde indisponible"}, ensure_ascii=False, indent=2))
