#!/usr/bin/env python3
"""Collecte de la consommation DeepSeek et écriture de `docs/data/suivi.json`.

Le fichier produit alimente le tableau de bord publié sur GitHub Pages. Il ne
contient **aucun secret** (pas de clé d'API, pas de contenu de conversation).

    python3 outils/collecter.py                 # avec solde du compte
    python3 outils/collecter.py --sans-solde     # collecte hors ligne
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from outils import differe, horaires, sessions, solde as module_solde, tarifs  # noqa: E402

RACINE = Path(__file__).resolve().parent.parent
SORTIE = RACINE / "docs" / "data" / "suivi.json"
JOURS = ("dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi")


def _iso(moment: dt.datetime) -> str:
    return moment.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def collecter(base: Path | None = None, avec_solde: bool = True) -> dict:
    """Construit le document complet de suivi."""
    connexion = sessions.ouvrir(base)
    config = sessions.charger_profils()
    lignes_sessions = sessions.sessions(connexion)
    lignes_usage = sessions.usage(connexion)
    depots = sessions.depots_par_session(connexion)
    connexion.close()

    # --- attribution de chaque session -------------------------------------
    attribution: dict[str, dict[str, str]] = {}
    for session in lignes_sessions:
        profil, application = sessions.attribuer(
            session["name"], session["working_dir"], depots.get(session["id"], []), config
        )
        attribution[session["id"]] = {
            "profil": profil,
            "application": application,
            "couleur": sessions.couleur_profil(profil, config),
            "nom": session["name"] or session["id"],
            "dossier": session["working_dir"],
        }

    par_session: dict[str, dict] = defaultdict(
        lambda: {
            "requetes": 0,
            "cout_officiel": 0.0,
            "cout_officiel_pleine": 0.0,
            "cout_officiel_creuse": 0.0,
            "cout_goose": 0.0,
            "tokens_entree": 0,
            "tokens_sortie": 0,
            "tokens_cache": 0,
            "premier": None,
            "dernier": None,
        }
    )
    par_app: dict[str, dict] = defaultdict(
        lambda: {
            "cout_officiel": 0.0,
            "cout_pleine": 0.0,
            "cout_creuse": 0.0,
            "requetes": 0,
            "tokens": 0,
            "sessions": set(),
            "derniere_activite": None,
            "profil": "Goose & divers",
            "couleur": config.get("couleur_defaut", "#64748b"),
        }
    )
    par_profil: dict[str, dict] = defaultdict(
        lambda: {
            "cout_officiel": 0.0,
            "cout_pleine": 0.0,
            "cout_creuse": 0.0,
            "requetes": 0,
            "tokens": 0,
            "sessions": set(),
            "couleur": config.get("couleur_defaut", "#64748b"),
        }
    )
    par_jour: dict[str, dict] = defaultdict(
        lambda: {"cout_officiel": 0.0, "cout_pleine": 0.0, "cout_creuse": 0.0, "requetes": 0, "tokens": 0}
    )
    thermique: dict[tuple[int, int], dict] = defaultdict(
        lambda: {"cout": 0.0, "requetes": 0, "tokens": 0}
    )

    totaux = {
        "requetes": 0,
        "cout_officiel": 0.0,
        "cout_officiel_pleine": 0.0,
        "cout_officiel_creuse": 0.0,
        "cout_goose": 0.0,
        "tokens_entree": 0,
        "tokens_sortie": 0,
        "tokens_cache": 0,
        "tokens_total": 0,
    }

    feries = horaires.jours_feries_chinois()
    for ligne in lignes_usage:
        moment = dt.datetime.fromtimestamp(ligne["created_timestamp"], tz=dt.timezone.utc)
        pleine = horaires.est_heure_pleine(moment, feries)
        cout = tarifs.cout_requete(
            ligne["model"],
            ligne["input_tokens"],
            ligne["output_tokens"],
            ligne["cache_read_tokens"],
            pleine,
        )
        info = attribution.get(ligne["session_id"])
        profil = info["profil"] if info else "Goose & divers"
        application = info["application"] if info else "Divers"
        couleur = info["couleur"] if info else config.get("couleur_defaut", "#64748b")
        tokens = int(ligne["total_tokens"] or 0)
        cout_goose = float(ligne["cost"] or 0.0)

        totaux["requetes"] += 1
        totaux["cout_officiel"] += cout
        totaux["cout_goose"] += cout_goose
        totaux["tokens_entree"] += int(ligne["input_tokens"] or 0)
        totaux["tokens_sortie"] += int(ligne["output_tokens"] or 0)
        totaux["tokens_cache"] += int(ligne["cache_read_tokens"] or 0)
        totaux["tokens_total"] += tokens
        totaux["cout_officiel_pleine" if pleine else "cout_officiel_creuse"] += cout

        accumulateur = par_session[ligne["session_id"]]
        accumulateur["requetes"] += 1
        accumulateur["cout_officiel"] += cout
        accumulateur["cout_officiel_pleine" if pleine else "cout_officiel_creuse"] += cout
        accumulateur["cout_goose"] += cout_goose
        accumulateur["tokens_entree"] += int(ligne["input_tokens"] or 0)
        accumulateur["tokens_sortie"] += int(ligne["output_tokens"] or 0)
        accumulateur["tokens_cache"] += int(ligne["cache_read_tokens"] or 0)
        accumulateur["premier"] = accumulateur["premier"] or _iso(moment)
        accumulateur["dernier"] = _iso(moment)

        application_courante = par_app[application]
        application_courante["cout_officiel"] += cout
        application_courante["cout_pleine" if pleine else "cout_creuse"] += cout
        application_courante["requetes"] += 1
        application_courante["tokens"] += tokens
        application_courante["sessions"].add(ligne["session_id"])
        application_courante["derniere_activite"] = _iso(moment)
        application_courante["profil"] = profil
        application_courante["couleur"] = couleur

        profil_courant = par_profil[profil]
        profil_courant["cout_officiel"] += cout
        profil_courant["cout_pleine" if pleine else "cout_creuse"] += cout
        profil_courant["requetes"] += 1
        profil_courant["tokens"] += tokens
        profil_courant["sessions"].add(ligne["session_id"])
        profil_courant["couleur"] = couleur

        jour = par_jour[moment.date().isoformat()]
        jour["cout_officiel"] += cout
        jour["cout_pleine" if pleine else "cout_creuse"] += cout
        jour["requetes"] += 1
        jour["tokens"] += tokens

        cellule = thermique[(moment.weekday(), moment.hour)]
        cellule["cout"] += cout
        cellule["requetes"] += 1
        cellule["tokens"] += tokens

    resultat = {
        "genere_le": _iso(dt.datetime.now(dt.timezone.utc)),
        "source_donnees": "base de sessions goose (~/.local/share/goose/sessions/sessions.db)",
        "regle_horaires": {
            "pleines": horaires.REGLE,
            "source": horaires.SOURCE,
            "jours_feries_chinois": sorted(horaires.jours_feries_chinois()),
        },
        "grille_tarifaire": {
            "source": tarifs.charger()["source"],
            "releve_le": tarifs.charger()["releve_le"],
            "devise": tarifs.charger()["devise"],
            "unite": tarifs.charger()["unite"],
            "modeles": tarifs.charger()["modeles"],
        },
        "lien_recharge": tarifs.lien_recharge(),
        "solde": module_solde.recuperer() if avec_solde else None,
        "totaux": {
            **{cle: round(valeur, 6) for cle, valeur in totaux.items() if cle.startswith("cout")},
            **{cle: valeur for cle, valeur in totaux.items() if not cle.startswith("cout")},
            "economie_possible": round(totaux["cout_officiel_pleine"], 6),
            "part_pleine": round(
                totaux["cout_officiel_pleine"] / totaux["cout_officiel"] if totaux["cout_officiel"] else 0, 4
            ),
            "taux_cache": round(
                totaux["tokens_cache"] / totaux["tokens_entree"] if totaux["tokens_entree"] else 0, 4
            ),
        },
        "profils": _trier_profils(par_profil, config),
        "applications": _trier_applications(par_app),
        "jours": [
            {"date": date, **{cle: round(valeur, 6) if cle.startswith("cout") else valeur for cle, valeur in valeurs.items()}}
            for date, valeurs in sorted(par_jour.items())
        ],
        "thermique": [
            {
                "jour": index,
                "jour_nom": JOURS[index],
                "heure_utc": heure,
                "pleine": horaires.est_heure_pleine(
                    dt.datetime(2026, 9, 28, heure, tzinfo=dt.timezone.utc)  # lundi de référence
                ),
                **{cle: round(valeur, 6) if cle == "cout" else valeur for cle, valeur in valeurs.items()},
            }
            for (index, heure), valeurs in sorted(thermique.items())
        ],
        "sessions": _trier_sessions(lignes_sessions, attribution, par_session),
        "en_attente": differe.taches("en_attente"),
        "en_attente_traitees": [
            t for t in differe.taches(None) if t.get("statut") != "en_attente"
        ],
    }
    return resultat


def _trier_profils(profils: dict, config: dict) -> list[dict]:
    resultat = [
        {
            "nom": nom,
            "cout_officiel": round(valeurs["cout_officiel"], 6),
            "cout_pleine": round(valeurs["cout_pleine"], 6),
            "cout_creuse": round(valeurs["cout_creuse"], 6),
            "requetes": valeurs["requetes"],
            "tokens": valeurs["tokens"],
            "sessions": len(valeurs["sessions"]),
            "couleur": valeurs["couleur"],
        }
        for nom, valeurs in profils.items()
    ]
    return sorted(resultat, key=lambda p: -p["cout_officiel"])


def _trier_applications(applications: dict) -> list[dict]:
    resultat = [
        {
            "nom": nom,
            "profil": valeurs["profil"],
            "couleur": valeurs["couleur"],
            "cout_officiel": round(valeurs["cout_officiel"], 6),
            "cout_pleine": round(valeurs["cout_pleine"], 6),
            "cout_creuse": round(valeurs["cout_creuse"], 6),
            "requetes": valeurs["requetes"],
            "tokens": valeurs["tokens"],
            "sessions": len(valeurs["sessions"]),
            "derniere_activite": valeurs["derniere_activite"],
        }
        for nom, valeurs in applications.items()
    ]
    return sorted(resultat, key=lambda a: -a["cout_officiel"])


def _trier_sessions(
    lignes_sessions: list[dict], attribution: dict, par_session: dict
) -> list[dict]:
    resultat = []
    for session in lignes_sessions:
        agregat = par_session.get(session["id"])
        info = attribution.get(session["id"], {})
        resultat.append(
            {
                "id": session["id"],
                "nom": session["name"] or session["id"],
                "application": info.get("application", "Divers"),
                "profil": info.get("profil", "Goose & divers"),
                "couleur": info.get("couleur", "#64748b"),
                "dossier": session["working_dir"],
                "modele": session["modele"],
                "debut": session["created_at"],
                "fin": session["updated_at"],
                "cout_officiel": round(agregat["cout_officiel"], 6) if agregat else 0.0,
                "cout_pleine": round(agregat["cout_officiel_pleine"], 6) if agregat else 0.0,
                "cout_creuse": round(agregat["cout_officiel_creuse"], 6) if agregat else 0.0,
                "cout_goose": round(agregat["cout_goose"], 6) if agregat else 0.0,
                "requetes": agregat["requetes"] if agregat else 0,
                "tokens": (agregat["tokens_entree"] + agregat["tokens_sortie"]) if agregat else 0,
                "tokens_cache": agregat["tokens_cache"] if agregat else 0,
            }
        )
    return sorted(resultat, key=lambda s: s["fin"] or "", reverse=True)


def ecrire(document: dict, sortie: Path | None = None) -> Path:
    """Écrit le document JSON et renvoie son chemin."""
    chemin = Path(sortie or SORTIE)
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return chemin


def main(argv: list[str] | None = None) -> int:
    analyseur = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    analyseur.add_argument("--base", help="base de sessions goose (chemin du sessions.db)")
    analyseur.add_argument("--sortie", help="fichier JSON de sortie")
    analyseur.add_argument("--sans-solde", action="store_true", help="ne pas interroger l'API de solde")
    options = analyseur.parse_args(argv)

    document = collecter(
        base=Path(options.base) if options.base else None, avec_solde=not options.sans_solde
    )
    chemin = ecrire(document, Path(options.sortie) if options.sortie else None)
    totaux = document["totaux"]
    print(
        f"{chemin} écrit — {totaux['requetes']} requêtes, "
        f"{totaux['cout_officiel']:.4f} $ (dont {totaux['cout_officiel_pleine']:.4f} $ en heures pleines), "
        f"{len(document['en_attente'])} demande(s) en attente."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
