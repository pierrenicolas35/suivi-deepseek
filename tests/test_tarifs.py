"""Grille tarifaire et calcul du coût d'une requête."""

import json

import pytest

from outils import tarifs


def test_chargement_de_la_grille():
    grille = tarifs.charger()
    assert grille["devise"] == "USD"
    assert "deepseek-flash" in grille["modeles"]
    assert grille["lien_recharge"].startswith("https://platform.deepseek.com/")


def test_remise_creuse_est_la_moitie():
    tarifs_modele = tarifs.tarif_modele("deepseek-flash")
    for categorie, valeurs in tarifs_modele.items():
        if isinstance(valeurs, dict):
            assert pytest.approx(valeurs["creuse"] * 2) == valeurs["pleine"]


def test_alias_de_modele():
    assert tarifs.modele_canonique("deepseek-v4-flash") == "deepseek-flash"
    assert tarifs.modele_canonique("deepseek-v4-flash-vision-exp") == "deepseek-flash"
    assert tarifs.modele_canonique("inconnu") == "deepseek-flash"


def test_cout_requete_heure_pleine_flash():
    """Exemple réel : 25 548 tokens d'entrée dont 25 344 en cache, 146 en sortie."""
    cout = tarifs.cout_requete("deepseek-flash", 25548, 146, 25344, heure_pleine=True)
    attendu = (204 * 0.30 + 25344 * 0.006 + 146 * 1.20) / 1_000_000
    assert cout == pytest.approx(attendu)
    assert cout == pytest.approx(0.000388464)


def test_cout_requete_creuse_vaut_la_moitie_de_la_pleine():
    pleine = tarifs.cout_requete("deepseek-flash", 25548, 146, 25344, heure_pleine=True)
    creuse = tarifs.cout_requete("deepseek-flash", 25548, 146, 25344, heure_pleine=False)
    assert creuse == pytest.approx(pleine / 2)


def test_cout_requete_sans_cache():
    cout = tarifs.cout_requete("deepseek-flash", 1_000_000, 0, 0, heure_pleine=True)
    assert cout == pytest.approx(0.30)


def test_le_cache_ne_depasse_jamais_l_entree():
    """Des tokens de cache supérieurs à l'entrée ne doivent pas créer de crédit."""
    cout = tarifs.cout_requete("deepseek-flash", 1000, 0, 999_999, heure_pleine=True)
    assert cout == pytest.approx(1000 * 0.006 / 1_000_000)


def test_grille_json_valide():
    """Le fichier de configuration reste un JSON valide et complet."""
    grille = json.loads((tarifs.RACINE / "config" / "tarifs.json").read_text(encoding="utf-8"))
    for modele, valeurs in grille["modeles"].items():
        for categorie in ("entree_cache_hit", "entree_cache_miss", "sortie"):
            assert set(valeurs[categorie]) == {"pleine", "creuse"}, (modele, categorie)
