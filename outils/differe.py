#!/usr/bin/env python3
"""File d'attente des demandes différées en heures creuses DeepSeek.

Quand une demande est reportée parce que nous sommes en heures pleines, elle est
enregistrée ici. Le tableau de bord la lit et affiche le prompt en attente,
l'application concernée et l'heure de bascule.

Commandes :

    python3 outils/differe.py ajouter --prompt "..." --application hdjverif
    python3 outils/differe.py liste
    python3 outils/differe.py executer 2026-09-23-1
    python3 outils/differe.py annuler 2026-09-23-1
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from outils import horaires, sessions, tarifs  # noqa: E402

RACINE = Path(__file__).resolve().parent.parent
FICHIER = RACINE / "data" / "en-attente.json"

STATUTS = ("en_attente", "executee", "annulee")


def _maintenant() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def charger() -> dict:
    """Contenu complet de la file (crée la structure si absente)."""
    if not FICHIER.exists():
        return {"maj_le": None, "taches": []}
    try:
        donnees = json.loads(FICHIER.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"maj_le": None, "taches": []}
    donnees.setdefault("taches", [])
    return donnees


def enregistrer(donnees: dict) -> None:
    donnees["maj_le"] = _maintenant().isoformat().replace("+00:00", "Z")
    FICHIER.parent.mkdir(parents=True, exist_ok=True)
    FICHIER.write_text(json.dumps(donnees, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _prochain_identifiant(taches: list[dict], maintenant: dt.datetime) -> str:
    prefixe = maintenant.strftime("%Y-%m-%d")
    numero = 1 + max(
        [int(t["id"].split("-")[-1]) for t in taches if t.get("id", "").startswith(prefixe)]
        or [0]
    )
    return f"{prefixe}-{numero}"


def ajouter(
    prompt: str,
    application: str | None = None,
    profil: str | None = None,
    session_id: str | None = None,
    note: str | None = None,
    maintenant: dt.datetime | None = None,
) -> dict:
    """Enregistre une demande à rejouer en heures creuses et renvoie la tâche."""
    moment = maintenant or _maintenant()
    donnees = charger()
    profil_calcule, application_calculee = (profil, application)
    if not application or not profil:
        config = sessions.charger_profils()
        profil_deduit, application_deduite = sessions.attribuer(
            application or "Divers", "", [], config
        )
        profil_calcule = profil or profil_deduit
        application_calculee = application or application_deduite
    tache = {
        "id": _prochain_identifiant(donnees["taches"], moment),
        "prompt": prompt.strip(),
        "application": application_calculee or "Divers",
        "profil": profil_calcule or "Goose & divers",
        "session_id": session_id,
        "cree_le": moment.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "cible": horaires.prochaine_heure_creuse(moment).isoformat().replace("+00:00", "Z"),
        "statut": "en_attente",
        "executee_le": None,
        "note": note,
    }
    donnees["taches"].append(tache)
    enregistrer(donnees)
    return tache


def taches(statut: str | None = "en_attente") -> list[dict]:
    """Tâches de la file, filtrées par statut (toutes si `statut` est None)."""
    liste = charger()["taches"]
    if statut is None:
        return liste
    return [t for t in liste if t.get("statut") == statut]


def changer_statut(identifiant: str, statut: str) -> dict:
    """Passe une tâche à `executee` ou `annulee`."""
    if statut not in STATUTS:
        raise ValueError(f"Statut inconnu : {statut}")
    donnees = charger()
    for tache in donnees["taches"]:
        if tache.get("id") == identifiant:
            tache["statut"] = statut
            if statut == "executee":
                tache["executee_le"] = _maintenant().isoformat().replace("+00:00", "Z")
            enregistrer(donnees)
            return tache
    raise KeyError(f"Aucune tâche « {identifiant} »")


def texte_liste(liste: list[dict]) -> str:
    """Rendu lisible de la file."""
    if not liste:
        return "Aucune demande en attente d'heures creuses."
    lignes = ["Demandes en attente d'heures creuses :"]
    for tache in liste:
        lignes.append(
            f"  [{tache['id']}] {tache.get('application', '?')} — {tache.get('statut')}\n"
            f"      prompt  : {tache.get('prompt', '')}\n"
            f"      cible   : {horaires.formater(dt.datetime.fromisoformat(tache['cible'].replace('Z', '+00:00')))}\n"
            f"      créée le: {tache.get('cree_le', '')}"
        )
    return "\n".join(lignes)


def main(argv: list[str] | None = None) -> int:
    analyseur = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sous = analyseur.add_subparsers(dest="commande", required=True)

    p_ajouter = sous.add_parser("ajouter", help="mettre une demande en attente d'heures creuses")
    p_ajouter.add_argument("--prompt", required=True, help="demande à rejouer telle quelle")
    p_ajouter.add_argument("--application", help="application ou dépôt concerné")
    p_ajouter.add_argument("--profil", help="profil concerné (Hermès / Planning, Apps GitHub…)")
    p_ajouter.add_argument("--session", dest="session_id", help="identifiant de session goose")
    p_ajouter.add_argument("--note", help="commentaire libre")

    p_liste = sous.add_parser("liste", help="afficher la file")
    p_liste.add_argument("--tous", action="store_true", help="inclure les tâches traitées")
    p_liste.add_argument("--json", action="store_true", dest="en_json")

    for nom, aide in (("executer", "marquer comme exécutée"), ("annuler", "annuler la demande")):
        p = sous.add_parser(nom, help=aide)
        p.add_argument("id")

    options = analyseur.parse_args(argv)

    if options.commande == "ajouter":
        tache = ajouter(
            options.prompt,
            application=options.application,
            profil=options.profil,
            session_id=options.session_id,
            note=options.note,
        )
        print(
            f"Demande {tache['id']} mise en attente pour {tache['application']}.\n"
            f"Exécution possible à partir de : "
            f"{horaires.formater(dt.datetime.fromisoformat(tache['cible'].replace('Z', '+00:00')))}.\n"
            f"Lien de recharge : {tarifs.lien_recharge()}"
        )
    elif options.commande == "liste":
        liste = taches(None if options.tous else "en_attente")
        if options.en_json:
            print(json.dumps(liste, ensure_ascii=False, indent=2))
        else:
            print(texte_liste(liste))
    else:
        statut = "executee" if options.commande == "executer" else "annulee"
        print(f"Demande {changer_statut(options.id, statut)['id']} → {statut}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
