"""Fenêtres tarifaires DeepSeek (heures pleines / creuses)."""

import datetime as dt

import pytest

from outils import horaires

UTC = dt.timezone.utc


def instant(aaaa_mm_jj_hh_mm: str) -> dt.datetime:
    return dt.datetime.strptime(aaaa_mm_jj_hh_mm, "%Y-%m-%d %H:%M").replace(tzinfo=UTC)


@pytest.mark.parametrize(
    ("moment", "attendu", "commentaire"),
    [
        ("2026-09-23 00:30", False, "nuit en semaine"),
        ("2026-09-23 01:00", True, "début de la fenêtre du matin"),
        ("2026-09-23 03:59", True, "fin de la première fenêtre"),
        ("2026-09-23 04:00", False, "creux entre les deux fenêtres"),
        ("2026-09-23 06:00", True, "début de la seconde fenêtre"),
        ("2026-09-23 09:59", True, "fin de la seconde fenêtre"),
        ("2026-09-23 10:00", False, "après la seconde fenêtre"),
        ("2026-09-23 14:00", False, "après-midi"),
        ("2026-09-26 02:00", False, "samedi"),
        ("2026-09-27 09:00", False, "dimanche"),
        ("2026-09-26 23:59", False, "samedi soir"),
        ("2026-09-28 00:59", False, "lundi avant la fenêtre"),
        ("2026-09-28 01:00", True, "lundi dans la fenêtre"),
    ],
)
def test_est_heure_pleine(moment, attendu, commentaire):
    assert horaires.est_heure_pleine(instant(moment)) is attendu, commentaire


def test_jour_ferie_chinois_entierement_creux():
    """Un jour férié chinois reste en heures creuses même en semaine."""
    lundi_ferie = instant("2026-10-05 02:00")
    assert horaires.est_heure_pleine(lundi_ferie, feries=set()) is True
    assert horaires.est_heure_pleine(lundi_ferie, feries={"2026-10-05"}) is False


def test_prochaine_bascule_depuis_heure_pleine():
    bascule, devient_pleine = horaires.prochaine_bascule(instant("2026-09-23 08:24"))
    assert bascule == instant("2026-09-23 10:00")
    assert devient_pleine is False


def test_prochaine_bascule_depuis_heure_creuse():
    bascule, devient_pleine = horaires.prochaine_bascule(instant("2026-09-23 22:00"))
    assert bascule == instant("2026-09-24 01:00")
    assert devient_pleine is True


def test_prochaine_heure_creuse_pendant_les_heures_pleines():
    assert horaires.prochaine_heure_creuse(instant("2026-09-23 08:24")) == instant("2026-09-23 10:00")


def test_prochaine_heure_creuse_quand_on_y_est_deja():
    maintenant = instant("2026-09-23 12:00")
    assert horaires.prochaine_heure_creuse(maintenant) == maintenant


def test_prochaine_heure_creuse_pendant_une_fenetre_du_matin():
    """Dans la première fenêtre pleine, la cible est la fin de cette fenêtre."""
    assert horaires.prochaine_heure_creuse(instant("2026-09-28 02:00")) == instant("2026-09-28 04:00")
    assert horaires.prochaine_heure_creuse(instant("2026-09-28 06:30")) == instant("2026-09-28 10:00")


def test_prochaine_heure_creuse_le_vendredi_soir_part_au_samedi():
    vendredi = instant("2026-09-25 23:00")
    assert horaires.est_heure_pleine(vendredi) is False
    assert horaires.prochaine_heure_creuse(vendredi) == vendredi


def test_duree_lisible():
    assert horaires.duree_lisible(dt.timedelta(minutes=96)) == "1 h 36 min"
    assert horaires.duree_lisible(dt.timedelta(minutes=30)) == "30 min"
    assert horaires.duree_lisible(dt.timedelta(hours=46)) == "1 j 22 h"


def test_etat_json_serialisable():
    import json

    document = horaires.etat(instant("2026-09-23 08:24"))
    assert document["heure_pleine"] is True
    assert document["bascule_dans_secondes"] == 5760
    assert document["prochaine_heure_creuse_utc"] == "2026-09-23T10:00:00Z"
    json.dumps(document)


def test_resume_annonce_la_remise_en_heures_creuses():
    texte = horaires.resume(instant("2026-09-23 12:00"))
    assert "HEURES CREUSES" in texte
    assert "50 %" in texte


def test_resume_annonce_le_retour_en_heures_pleines():
    texte = horaires.resume(instant("2026-09-23 08:24"))
    assert "HEURES PLEINES" in texte
    assert "HEURES CREUSES" in texte
