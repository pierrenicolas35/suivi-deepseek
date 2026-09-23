#!/usr/bin/env python3
"""Lecture (jamais en écriture) de la base de sessions goose.

Source des statistiques : la table `usage_ledger` (une ligne par appel au
modèle, avec horodatage, tokens et coût estimé par goose) et la table
`sessions` (nom, dossier de travail, modèle, coût cumulé).
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
CONFIG = RACINE / "config"

#: Emplacement par défaut de la base de sessions goose.
BASE_PAR_DEFAUT = Path.home() / ".local/share/goose/sessions/sessions.db"

MOTIF_DEPOT = re.compile(r"github\.com[/:]([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)")


def ouvrir(base: Path | None = None) -> sqlite3.Connection:
    """Ouvre la base goose en lecture seule."""
    chemin = Path(base or BASE_PAR_DEFAUT).expanduser()
    if not chemin.exists():
        raise FileNotFoundError(f"Base de sessions introuvable : {chemin}")
    connexion = sqlite3.connect(f"file:{chemin}?mode=ro", uri=True)
    connexion.row_factory = sqlite3.Row
    return connexion


def sessions(connexion: sqlite3.Connection) -> list[dict]:
    """Toutes les sessions, avec le nom du modèle extrait de la configuration."""
    lignes = connexion.execute(
        """
        SELECT id, name, working_dir, provider_name, model_config_json,
               accumulated_cost, accumulated_total_tokens,
               created_at, updated_at, goose_mode, session_type, recipe_json
        FROM sessions
        ORDER BY created_at
        """
    ).fetchall()
    resultat = []
    for ligne in lignes:
        session = dict(ligne)
        session["modele"] = _modele(session.pop("model_config_json", None))
        resultat.append(session)
    return resultat


def _modele(brut: str | None) -> str:
    if not brut:
        return "deepseek-flash"
    try:
        return json.loads(brut).get("model_name") or "deepseek-flash"
    except json.JSONDecodeError:
        return "deepseek-flash"


def usage(connexion: sqlite3.Connection) -> list[dict]:
    """Une entrée par appel au modèle (table `usage_ledger`)."""
    lignes = connexion.execute(
        """
        SELECT session_id, created_timestamp, model, input_tokens, output_tokens,
               total_tokens, cache_read_tokens, cache_write_tokens, cost, is_compaction
        FROM usage_ledger
        ORDER BY created_timestamp
        """
    ).fetchall()
    return [dict(ligne) for ligne in lignes]


def depots_par_session(connexion: sqlite3.Connection) -> dict[str, list[str]]:
    """Dépôts GitHub cités dans les messages, du plus cité au moins cité."""
    compteurs: dict[str, dict[str, int]] = {}
    for session_id, contenu in connexion.execute("SELECT session_id, content_json FROM messages"):
        for correspondance in MOTIF_DEPOT.finditer(contenu or ""):
            depot = correspondance.group(2).removesuffix(".git")
            compteurs.setdefault(session_id, {})[depot] = (
                compteurs.get(session_id, {}).get(depot, 0) + 1
            )
    return {
        session_id: [depot for depot, _ in sorted(v.items(), key=lambda e: -e[1])]
        for session_id, v in compteurs.items()
    }


def charger_profils() -> dict:
    return json.loads((CONFIG / "profils.json").read_text(encoding="utf-8"))


def _correspond(motifs: list[str] | None, textes: list[str]) -> bool:
    for motif in motifs or []:
        for texte in textes:
            if texte and re.search(motif, texte, re.IGNORECASE):
                return True
    return False


def attribuer(
    nom: str, dossier: str, depots: list[str], config: dict | None = None
) -> tuple[str, str]:
    """Renvoie (profil, application) d'une session.

    Ordre de priorité : dépôt GitHub cité, puis dossier de travail, puis nom de
    la session. Les règles vivent dans `config/profils.json`.
    """
    config = config or charger_profils()
    ignores = set(config.get("depots_ignores", []))
    retenus = [depot for depot in depots if depot not in ignores]
    texte_nom = nom or ""
    texte_dossier = dossier or ""

    profil = None
    for regle in config.get("profils", []):
        if _correspond(regle.get("noms"), [texte_nom]) or _correspond(
            regle.get("dossiers"), [texte_dossier]
        ):
            profil = regle["nom"]
            break

    application = None
    for regle in config.get("apps", []):
        if _correspond(regle.get("motifs"), [texte_nom, texte_dossier]):
            application = regle["nom"]
            profil = profil or regle.get("profil")
            break
    if application is None and retenus:
        # Aucun motif de nom : le dépôt GitHub cité dans la session fait foi.
        application = retenus[0]

    return (profil or config.get("profil_defaut", "Goose & divers"), application or "Divers")


def couleur_profil(profil: str, config: dict | None = None) -> str:
    config = config or charger_profils()
    for regle in config.get("profils", []):
        if regle["nom"] == profil:
            return regle.get("couleur", config.get("couleur_defaut", "#64748b"))
    return config.get("couleur_defaut", "#64748b")
