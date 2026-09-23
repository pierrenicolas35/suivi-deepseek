#!/usr/bin/env python3
"""Fenêtres tarifaires de l'API DeepSeek : heures pleines / heures creuses.

Règle officielle (https://api-docs.deepseek.com/quick_start/pricing) :

* Heures **pleines** : lundi → vendredi, 01:00-04:00 UTC et 06:00-10:00 UTC,
  hors jours fériés chinois (tarif normal).
* Toutes les autres heures sont **creuses** : nuits, week-ends complets et
  jours fériés chinois complets (tarifs divisés par deux).

Utilisation :

    python3 outils/horaires.py            # phrase lisible
    python3 outils/horaires.py --json     # état exploitable par un programme
    python3 outils/horaires.py --a 2026-09-26T03:00:00Z
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

RACINE = Path(__file__).resolve().parent.parent
CONFIG = RACINE / "config"

#: Fenêtres d'heures pleines, en heures UTC, du lundi au vendredi.
FENETRES_PLEINES_UTC: tuple[tuple[int, int], ...] = ((1, 4), (6, 10))

#: Libellé de la règle, repris dans l'interface.
REGLE = "lundi-vendredi 01:00-04:00 et 06:00-10:00 UTC, hors jours fériés chinois"
SOURCE = "https://api-docs.deepseek.com/quick_start/pricing"

JOURS_SEMAINE = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")


def tz_locale() -> dt.tzinfo:
    """Fuseau d'affichage (Europe/Paris), repli sur UTC si indisponible."""
    try:
        return ZoneInfo("Europe/Paris")
    except (ZoneInfoNotFoundError, ValueError):  # pragma: no cover - dépend du système
        return dt.timezone.utc


def jours_feries_chinois() -> set[str]:
    """Dates (AAAA-MM-JJ) entièrement facturées au tarif creux."""
    fichier = CONFIG / "jours_feries_cn.json"
    if not fichier.exists():
        return set()
    try:
        donnees = json.loads(fichier.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return set()
    return {str(d) for d in donnees.get("dates", [])}


def _utc(instant: dt.datetime) -> dt.datetime:
    if instant.tzinfo is None:
        return instant.replace(tzinfo=dt.timezone.utc)
    return instant.astimezone(dt.timezone.utc)


def est_heure_pleine(instant: dt.datetime, feries: set[str] | None = None) -> bool:
    """Vrai si `instant` tombe dans une fenêtre facturée au tarif normal."""
    moment = _utc(instant)
    if moment.weekday() >= 5:  # samedi / dimanche : creux toute la journée
        return False
    if moment.date().isoformat() in (feries if feries is not None else jours_feries_chinois()):
        return False
    return any(debut <= moment.hour < fin for debut, fin in FENETRES_PLEINES_UTC)


def prochaine_bascule(
    instant: dt.datetime, feries: set[str] | None = None, horizon_jours: int = 10
) -> tuple[dt.datetime, bool]:
    """Renvoie (horodatage UTC de la prochaine bascule, devient_pleine)."""
    moment = _utc(instant).replace(second=0, microsecond=0)
    etat = est_heure_pleine(moment, feries)
    limite = moment + dt.timedelta(days=horizon_jours)
    curseur = moment
    while curseur < limite:
        curseur += dt.timedelta(minutes=1)
        if est_heure_pleine(curseur, feries) != etat:
            return curseur, not etat
    return limite, not etat  # pragma: no cover - horizon large, jamais atteint en pratique


def prochaine_heure_creuse(instant: dt.datetime, feries: set[str] | None = None) -> dt.datetime:
    """Horodatage UTC du prochain début d'heures creuses (cible d'un report)."""
    moment = _utc(instant)
    if not est_heure_pleine(moment, feries):
        return moment
    bascule, devient_pleine = prochaine_bascule(moment, feries)
    if not devient_pleine:
        return bascule
    # La bascule suivante fait repasser en creux.
    return prochaine_bascule(bascule, feries)[0]


def duree_lisible(delta: dt.timedelta) -> str:
    """« 1 h 36 min », « 2 j 3 h »."""
    total = int(max(delta.total_seconds(), 0) // 60)
    jours, reste = divmod(total, 24 * 60)
    heures, minutes = divmod(reste, 60)
    if jours:
        return f"{jours} j {heures} h" if heures else f"{jours} j"
    if heures:
        return f"{heures} h {minutes:02d} min" if minutes else f"{heures} h"
    return f"{minutes} min"


def formater(instant: dt.datetime) -> str:
    """« mer. 23/09/2026 10:24 UTC (12:24 à Paris) »."""
    moment = _utc(instant)
    local = moment.astimezone(tz_locale())
    base = (
        f"{JOURS_SEMAINE[moment.weekday()][:3]}. "
        f"{moment.strftime('%d/%m/%Y %H:%M')} UTC"
    )
    if local.utcoffset() != dt.timedelta(0):
        base += f" ({local.strftime('%H:%M')} à Paris)"
    return base


def etat(instant: dt.datetime | None = None) -> dict:
    """État complet, sérialisable en JSON."""
    moment = _utc(instant or dt.datetime.now(dt.timezone.utc))
    feries = jours_feries_chinois()
    pleine = est_heure_pleine(moment, feries)
    bascule, devient_pleine = prochaine_bascule(moment, feries)
    prochaine_creuse = prochaine_heure_creuse(moment, feries)
    return {
        "instant_utc": moment.isoformat().replace("+00:00", "Z"),
        "instant_local": moment.astimezone(tz_locale()).isoformat(),
        "heure_pleine": pleine,
        "libelle": "HEURES PLEINES" if pleine else "HEURES CREUSES",
        "remise": None if pleine else 0.5,
        "regle": REGLE,
        "source": SOURCE,
        "bascule_utc": bascule.isoformat().replace("+00:00", "Z"),
        "bascule_vers": "pleines" if devient_pleine else "creuses",
        "bascule_dans": duree_lisible(bascule - moment),
        "bascule_dans_secondes": int((bascule - moment).total_seconds()),
        "prochaine_heure_creuse_utc": prochaine_creuse.isoformat().replace("+00:00", "Z"),
        "prochaine_heure_creuse_dans": duree_lisible(prochaine_creuse - moment),
        "jours_feries_chinois": sorted(feries),
    }


def resume(instant: dt.datetime | None = None) -> str:
    """Phrase affichée au démarrage d'une session goose."""
    info = etat(instant)
    icone = "⏰" if info["heure_pleine"] else "🌙"
    lignes = [f"{icone} {info['libelle']} — {formater(dt.datetime.fromisoformat(info['instant_utc'].replace('Z', '+00:00')))}"]
    if info["heure_pleine"]:
        lignes.append(
            "   Tarif normal DeepSeek. Passage en HEURES CREUSES (-50 %) : "
            f"{formater(dt.datetime.fromisoformat(info['bascule_utc'].replace('Z', '+00:00')))}, "
            f"soit dans {info['bascule_dans']}."
        )
    else:
        lignes.append(
            "   Remise de 50 % appliquée sur tous les tokens. Retour en heures pleines : "
            f"{formater(dt.datetime.fromisoformat(info['bascule_utc'].replace('Z', '+00:00')))}, "
            f"soit dans {info['bascule_dans']}."
        )
    lignes.append(f"   Règle : {REGLE}.")
    return "\n".join(lignes)


def main(argv: list[str] | None = None) -> int:
    analyseur = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    analyseur.add_argument("--json", action="store_true", help="sortie JSON")
    analyseur.add_argument("--a", dest="instant", help="instant à évaluer (ISO 8601, ex. 2026-09-26T03:00:00Z)")
    options = analyseur.parse_args(argv)

    instant = None
    if options.instant:
        instant = dt.datetime.fromisoformat(options.instant.replace("Z", "+00:00"))

    if options.json:
        print(json.dumps(etat(instant), ensure_ascii=False, indent=2))
    else:
        print(resume(instant))
    return 0


if __name__ == "__main__":
    sys.exit(main())
