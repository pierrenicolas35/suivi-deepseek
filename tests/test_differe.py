"""File d'attente des demandes différées en heures creuses."""

import datetime as dt

import pytest

from outils import differe, horaires

UTC = dt.timezone.utc


@pytest.fixture(autouse=True)
def file_isolee(tmp_path, monkeypatch):
    """Chaque test travaille sur une file vide et isolée."""
    monkeypatch.setattr(differe, "FICHIER", tmp_path / "en-attente.json")


def test_ajouter_une_demande_en_attente():
    tache = differe.ajouter(
        "Refonte de la page d'accueil",
        application="hdjverif",
        profil="Apps GitHub",
        session_id="20260923_1",
        maintenant=dt.datetime(2026, 9, 23, 8, 24, tzinfo=UTC),
    )
    assert tache["id"] == "2026-09-23-1"
    assert tache["statut"] == "en_attente"
    assert tache["cible"] == "2026-09-23T10:00:00Z"
    assert horaires.est_heure_pleine(dt.datetime.fromisoformat(tache["cible"].replace("Z", "+00:00"))) is False
    assert tache["prompt"] == "Refonte de la page d'accueil"


def test_identifiants_sequencés_par_jour():
    moment = dt.datetime(2026, 9, 23, 8, 24, tzinfo=UTC)
    premier = differe.ajouter("une", maintenant=moment)
    second = differe.ajouter("deux", maintenant=moment)
    assert premier["id"].endswith("-1")
    assert second["id"].endswith("-2")
    assert len(differe.taches()) == 2


def test_heure_creuse_immediate_quand_on_y_est():
    moment = dt.datetime(2026, 9, 23, 12, 0, tzinfo=UTC)
    tache = differe.ajouter("déjà en heures creuses", maintenant=moment)
    assert tache["cible"] == "2026-09-23T12:00:00Z"


def test_profil_deduit_de_l_application():
    tache = differe.ajouter("corriger la grille", application="Hermès planning")
    assert tache["profil"] == "Hermès / Planning"


def test_executer_et_annuler():
    tache = differe.ajouter("à exécuter")
    differe.changer_statut(tache["id"], "executee")
    assert differe.taches("en_attente") == []
    assert differe.taches("executee")[0]["executee_le"] is not None

    autre = differe.ajouter("à annuler")
    differe.changer_statut(autre["id"], "annulee")
    assert differe.taches("annulee")[0]["id"] == autre["id"]


def test_statut_inconnu_refuse():
    tache = differe.ajouter("x")
    with pytest.raises(ValueError):
        differe.changer_statut(tache["id"], "peut-être")


def test_identifiant_inconnu():
    with pytest.raises(KeyError):
        differe.changer_statut("2026-09-23-99", "executee")


def test_texte_liste_vide():
    assert "Aucune" in differe.texte_liste([])


def test_texte_liste_contient_prompt_et_cible():
    differe.ajouter("Relancer le calcul ETP", application="calculETP")
    texte = differe.texte_liste(differe.taches())
    assert "Relancer le calcul ETP" in texte
    assert "calculETP" in texte
    assert "cible" in texte


def test_file_corrompue_ne_plante_pas(tmp_path):
    differe.FICHIER.write_text("{ pas du json", encoding="utf-8")
    assert differe.charger()["taches"] == []


def test_ajout_puis_religature_de_la_file():
    differe.ajouter("première")
    differe.ajouter("seconde")
    assert [t["prompt"] for t in differe.taches()] == ["première", "seconde"]
