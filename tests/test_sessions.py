"""Lecture de la base goose et attribution aux profils / applications."""

import json
from pathlib import Path

import pytest

from outils import sessions


def config() -> dict:
    return sessions.charger_profils()


@pytest.mark.parametrize(
    ("nom", "dossier", "depots", "profil", "application"),
    [
        ("Refonte de l'interface HDJverif", "/home/ubuntu", ["hdjverif"], "Apps GitHub", "hdjverif"),
        ("Planning RH et pseudonymisation", "/home/ubuntu", [], "Hermès / Planning", "hermes-planning"),
        ("hermes-forge", "/home/ubuntu/hermes-planning", [], "Hermès / Planning", "hermes-planning"),
        ("Tiny print label editor", "/home/ubuntu", ["tiny-print"], "Apps GitHub", "tiny-print"),
        ("Where we left off", "/home/ubuntu", [], "Goose & divers", "mémoire & reprise"),
        ("Numéro API DeepSeek", "/home/ubuntu", [], "Goose & divers", "suivi DeepSeek"),
        ("Bots Telegram opérationnels", "/home/ubuntu", [], "Hermès / Planning", "bots Telegram"),
        ("Session mystère 42", "/home/ubuntu", [], "Goose & divers", "Divers"),
    ],
)
def test_attribution(nom, dossier, depots, profil, application):
    assert sessions.attribuer(nom, dossier, depots, config()) == (profil, application)


def test_le_motif_ash_ne_capture_pas_dashboard():
    """Régression : « ash » ne doit pas être trouvé dans « dashboard »."""
    profil, _ = sessions.attribuer("DeepSeek API usage dashboard", "/home/ubuntu", [], config())
    assert profil == "Goose & divers"


def test_le_depot_ignore_ne_guide_pas_l_attribution():
    """Un dépôt technique cité au fil de la conversation (runner-images) est ignoré."""
    _, application = sessions.attribuer("Session quelconque", "/home/ubuntu", ["runner-images"], config())
    assert application == "Divers"


def test_depot_en_secours_quand_aucun_motif_de_nom():
    _, application = sessions.attribuer("Session sans indice", "/home/ubuntu", ["chronos_natation"], config())
    assert application == "chronos_natation"


def test_couleur_profil():
    assert sessions.couleur_profil("Hermès / Planning", config()).startswith("#")
    assert sessions.couleur_profil("Inconnu", config()) == config()["couleur_defaut"]


def test_configuration_profils_valide():
    donnees = json.loads((sessions.CONFIG / "profils.json").read_text(encoding="utf-8"))
    assert donnees["profil_defaut"]
    assert all("nom" in profil for profil in donnees["profils"])
    assert all("nom" in app for app in donnees["apps"])


def test_lecture_de_la_base_reelle():
    """Test d'intégration : lecture seule de la base goose, si elle existe."""
    if not sessions.BASE_PAR_DEFAUT.exists():
        pytest.skip("base de sessions goose absente")
    connexion = sessions.ouvrir()
    try:
        lignes = sessions.sessions(connexion)
        usage = sessions.usage(connexion)
    finally:
        connexion.close()
    assert lignes, "au moins une session attendue"
    assert all(ligne["modele"] for ligne in lignes)
    for ligne in usage[:20]:
        assert ligne["total_tokens"] is None or ligne["total_tokens"] >= 0


def test_lecture_seule_de_la_base():
    """La base goose ne doit jamais être modifiée : seule l'ouverture `mode=ro` est utilisée."""
    source = Path(sessions.__file__).read_text(encoding="utf-8")
    assert "mode=ro" in source
    assert "INSERT" not in source.upper()
    assert "UPDATE " not in source.upper()
