#!/usr/bin/env python3
"""Grille tarifaire DeepSeek et calcul du coût d'une requête.

Les prix sont exprimés en dollars par million de tokens. La tarification creuse
vaut exactement la moitié de la tarification pleine (voir `config/tarifs.json`).
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
FICHIER = RACINE / "config" / "tarifs.json"


@lru_cache(maxsize=1)
def charger() -> dict:
    """Grille tarifaire complète."""
    return json.loads(FICHIER.read_text(encoding="utf-8"))


def modele_canonique(modele: str | None) -> str:
    """Résout les alias de modèle vers le modèle facturé."""
    grille = charger()
    nom = (modele or "").strip().lower()
    if nom in grille["modeles"]:
        return nom
    return grille.get("alias", {}).get(nom, "deepseek-flash")


def tarif_modele(modele: str | None) -> dict:
    """Tarifs pleine/creuse d'un modèle (avec repli sur le premier modèle connu)."""
    grille = charger()
    return grille["modeles"].get(modele_canonique(modele)) or next(iter(grille["modeles"].values()))


def prix(modele: str | None, categorie: str, heure_pleine: bool) -> float:
    """Prix d'un million de tokens pour une catégorie donnée."""
    tarifs = tarif_modele(modele)
    tranche = "pleine" if heure_pleine else "creuse"
    return float(tarifs[categorie][tranche])


def cout_requete(
    modele: str | None,
    tokens_entree: int | None,
    tokens_sortie: int | None,
    tokens_cache_lecture: int | None = None,
    heure_pleine: bool = False,
) -> float:
    """Coût en dollars d'une requête.

    `tokens_entree` est le total des tokens d'entrée ; les tokens servis depuis
    le cache (`tokens_cache_lecture`) y sont inclus et facturés à part, moins cher.
    """
    entree = int(tokens_entree or 0)
    sortie = int(tokens_sortie or 0)
    cache = min(int(tokens_cache_lecture or 0), entree)
    manquants = max(entree - cache, 0)
    return (
        manquants * prix(modele, "entree_cache_miss", heure_pleine)
        + cache * prix(modele, "entree_cache_hit", heure_pleine)
        + sortie * prix(modele, "sortie", heure_pleine)
    ) / 1_000_000


def lien_recharge() -> str:
    """URL de recharge du compte DeepSeek."""
    return charger().get("lien_recharge", "https://platform.deepseek.com/top_up")


if __name__ == "__main__":  # petit aide-mémoire en ligne de commande
    grille = charger()
    print(f"Grille du {grille['releve_le']} ({grille['unite']}, {grille['devise']})")
    for nom, tarifs in grille["modeles"].items():
        print(f"\n{nom} — {tarifs['libelle']}")
        for categorie in ("entree_cache_hit", "entree_cache_miss", "sortie"):
            valeurs = tarifs[categorie]
            print(f"  {categorie:<18} pleine {valeurs['pleine']:<8} creuse {valeurs['creuse']}")
