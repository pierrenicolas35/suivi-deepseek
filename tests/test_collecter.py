"""Agrégation des statistiques et écriture du document publié."""

import datetime as dt
import json
import sqlite3
from pathlib import Path

import pytest

from outils import collecter, differe, tarifs

UTC = dt.timezone.utc

SCHEMA = """
CREATE TABLE sessions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', description TEXT DEFAULT '',
    user_set_name BOOLEAN DEFAULT FALSE, session_type TEXT DEFAULT 'user',
    working_dir TEXT NOT NULL, created_at TIMESTAMP, updated_at TIMESTAMP,
    extension_data TEXT DEFAULT '{}', total_tokens INTEGER, input_tokens INTEGER,
    output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
    accumulated_total_tokens INTEGER, accumulated_input_tokens INTEGER,
    accumulated_output_tokens INTEGER, accumulated_cache_read_tokens INTEGER,
    accumulated_cache_write_tokens INTEGER, accumulated_cost REAL, schedule_id TEXT,
    recipe_json TEXT, user_recipe_values_json TEXT, provider_name TEXT,
    model_config_json TEXT, goose_mode TEXT DEFAULT 'auto', archived_at TIMESTAMP,
    project_id TEXT, parent_session_id TEXT
);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, session_id TEXT,
    role TEXT, content_json TEXT, created_timestamp INTEGER, timestamp TIMESTAMP,
    tokens INTEGER, metadata_json TEXT
);
CREATE TABLE usage_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, created_timestamp INTEGER,
    model TEXT, input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER,
    cache_read_tokens INTEGER, cache_write_tokens INTEGER, cost REAL, cost_source TEXT,
    is_compaction INTEGER DEFAULT 0
);
"""


def horodatage(texte: str) -> int:
    return int(dt.datetime.strptime(texte, "%Y-%m-%d %H:%M").replace(tzinfo=UTC).timestamp())


@pytest.fixture()
def base(tmp_path, monkeypatch):
    """Base goose factice : deux sessions, trois appels (un en heures pleines)."""
    monkeypatch.setattr(differe, "FICHIER", tmp_path / "en-attente.json")
    chemin = tmp_path / "sessions.db"
    connexion = sqlite3.connect(chemin)
    connexion.executescript(SCHEMA)
    connexion.executemany(
        "INSERT INTO sessions (id, name, working_dir, provider_name, model_config_json,"
        " accumulated_cost, accumulated_total_tokens, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        [
            (
                "s1",
                "Refonte de l'interface HDJverif",
                "/home/ubuntu",
                "custom_deepseek",
                json.dumps({"model_name": "deepseek-flash"}),
                0.0006,
                60000,
                "2026-09-23 01:55:00",
                "2026-09-23 12:05:00",
            ),
            (
                "s2",
                "Planning RH et pseudonymisation",
                "/home/ubuntu/hermes-planning",
                "custom_deepseek",
                json.dumps({"model_name": "deepseek-flash"}),
                0.0003,
                30000,
                "2026-09-23 11:50:00",
                "2026-09-23 12:10:00",
            ),
        ],
    )
    connexion.executemany(
        "INSERT INTO usage_ledger (session_id, created_timestamp, model, input_tokens,"
        " output_tokens, total_tokens, cache_read_tokens, cost) VALUES (?,?,?,?,?,?,?,?)",
        [
            # heures pleines (mercredi 02:00 UTC)
            ("s1", horodatage("2026-09-23 02:00"), "deepseek-flash", 10_000, 1_000, 11_000, 8_000, 0.0003),
            # heures creuses (mercredi 12:00 UTC)
            ("s1", horodatage("2026-09-23 12:00"), "deepseek-flash", 20_000, 2_000, 22_000, 16_000, 0.0003),
            ("s2", horodatage("2026-09-23 12:05"), "deepseek-flash", 30_000, 3_000, 33_000, 24_000, 0.0003),
        ],
    )
    connexion.execute(
        "INSERT INTO messages (session_id, content_json, created_timestamp)"
        " VALUES ('s1', ?, ?)",
        (json.dumps({"text": "voir github.com/pierrenicolas35/hdjverif"}), horodatage("2026-09-23 02:01")),
    )
    connexion.commit()
    connexion.close()
    return chemin


def test_collecte_globale(base):
    document = collecter.collecter(base=base, avec_solde=False)
    totaux = document["totaux"]
    assert totaux["requetes"] == 3
    assert totaux["tokens_entree"] == 60_000
    assert totaux["tokens_sortie"] == 6_000
    assert totaux["tokens_cache"] == 48_000
    assert totaux["taux_cache"] == pytest.approx(0.8)

    # Le coût pleine/creuse est recalculé depuis la grille officielle.
    attendu_pleine = tarifs.cout_requete("deepseek-flash", 10_000, 1_000, 8_000, heure_pleine=True)
    assert totaux["cout_officiel_pleine"] == pytest.approx(attendu_pleine, rel=1e-6)
    assert totaux["cout_officiel"] == pytest.approx(totaux["cout_officiel_pleine"] + totaux["cout_officiel_creuse"])
    assert totaux["economie_possible"] == pytest.approx(totaux["cout_officiel_pleine"], rel=1e-6)


def test_repartition_profils_et_applications(base):
    document = collecter.collecter(base=base, avec_solde=False)
    profils = {p["nom"]: p for p in document["profils"]}
    assert set(profils) == {"Apps GitHub", "Hermès / Planning"}
    assert profils["Apps GitHub"]["sessions"] == 1
    assert profils["Hermès / Planning"]["sessions"] == 1

    applications = {a["nom"]: a for a in document["applications"]}
    assert "hdjverif" in applications
    assert applications["hdjverif"]["profil"] == "Apps GitHub"
    assert applications["hermes-planning"]["profil"] == "Hermès / Planning"


def test_agregation_par_jour_et_carte_thermique(base):
    document = collecter.collecter(base=base, avec_solde=False)
    assert [jour["date"] for jour in document["jours"]] == ["2026-09-23"]
    jour = document["jours"][0]
    assert jour["requetes"] == 3
    assert jour["cout_pleine"] > 0 and jour["cout_creuse"] > 0

    cellules = {(c["jour"], c["heure_utc"]): c for c in document["thermique"]}
    assert cellules[(2, 2)]["pleine"] is True  # mercredi 02:00 UTC
    assert cellules[(2, 12)]["pleine"] is False
    assert cellules[(2, 12)]["requetes"] == 2


def test_sessions_triees_de_la_plus_recente_a_la_plus_ancienne(base):
    document = collecter.collecter(base=base, avec_solde=False)
    assert [session["id"] for session in document["sessions"]] == ["s2", "s1"]
    premiere = document["sessions"][1]
    assert premiere["application"] == "hdjverif"
    assert premiere["cout_pleine"] > 0
    assert premiere["cout_creuse"] > 0


def test_taches_en_attente_reprises_dans_le_document(base):
    differe.ajouter("Refaire la grille ASH", application="planning")
    document = collecter.collecter(base=base, avec_solde=False)
    assert len(document["en_attente"]) == 1
    assert document["en_attente"][0]["prompt"] == "Refaire la grille ASH"
    assert document["en_attente_traitees"] == []


def test_document_sans_secret(base):
    """Le document publié ne doit contenir aucune clé d'API."""
    document = collecter.collecter(base=base, avec_solde=False)
    texte = json.dumps(document, ensure_ascii=False)
    assert "sk-" not in texte
    assert "DEEPSEEK_API_KEY" not in texte
    assert "GITHUB_PERSONAL_ACCESS_TOKEN" not in texte


def test_ecriture_du_fichier(base, tmp_path):
    document = collecter.collecter(base=base, avec_solde=False)
    sortie = tmp_path / "docs" / "data" / "suivi.json"
    chemin = collecter.ecrire(document, sortie)
    assert chemin.exists()
    relu = json.loads(chemin.read_text(encoding="utf-8"))
    assert relu["totaux"]["requetes"] == 3
    assert relu["lien_recharge"] == tarifs.lien_recharge()


def test_base_absente():
    with pytest.raises(FileNotFoundError):
        collecter.sessions.ouvrir(Path("/inexistant/sessions.db"))


def test_document_publie_valide():
    """Le fichier livré dans le dépôt doit rester cohérent avec la page."""
    chemin = Path(collecter.SORTIE)
    if not chemin.exists():
        pytest.skip("suivi.json non généré")
    document = json.loads(chemin.read_text(encoding="utf-8"))
    for cle in ("totaux", "profils", "applications", "jours", "thermique", "sessions", "en_attente", "lien_recharge"):
        assert cle in document, cle
    assert "sk-" not in chemin.read_text(encoding="utf-8")
