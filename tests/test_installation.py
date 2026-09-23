"""Installation : commandes, application web installable (manifeste, service worker)."""

import json
import struct
import subprocess
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
DOCS = RACINE / "docs"
COMMANDES = ("deepseek-horaires", "deepseek-differe", "deepseek-collecter")


def test_scripts_de_commandes_presents_et_executables():
    for commande in COMMANDES:
        chemin = RACINE / "bin" / commande
        assert chemin.is_file(), f"{chemin} manquant"
        assert chemin.stat().st_mode & 0o111, f"{commande} n'est pas exécutable"


def test_installeur_syntaxiquement_valide_et_executable():
    installeur = RACINE / "installer.sh"
    assert installeur.is_file()
    assert installeur.stat().st_mode & 0o111, "installer.sh n'est pas exécutable"
    subprocess.run(["bash", "-n", str(installeur)], check=True)


def test_installeur_cree_les_liens_dans_un_home_isole(tmp_path):
    """L'installeur lie les trois commandes dans ~/.local/bin (HOME isolé)."""
    resultat = subprocess.run(
        ["bash", str(RACINE / "installer.sh")],
        env={
            "HOME": str(tmp_path),
            "XDG_CONFIG_HOME": str(tmp_path / ".config"),
            "PATH": "/usr/bin:/bin",
        },
        capture_output=True,
        text=True,
    )
    assert resultat.returncode == 0, resultat.stderr

    for commande in COMMANDES:
        lien = tmp_path / ".local" / "bin" / commande
        assert lien.is_symlink(), f"{lien} n'est pas un lien symbolique"
        assert lien.resolve() == (RACINE / "bin" / commande).resolve()


def test_installeur_option_hints_idempotente(tmp_path):
    """`--avec-hints` ajoute le bloc une seule fois, sans écraser l'existant."""
    environnement = {
        "HOME": str(tmp_path),
        "XDG_CONFIG_HOME": str(tmp_path / ".config"),
        "PATH": "/usr/bin:/bin",
    }
    hints = tmp_path / ".config" / "goose" / ".goosehints"
    hints.parent.mkdir(parents=True)
    hints.write_text("# Règles personnelles à conserver\n", encoding="utf-8")

    for _ in range(2):
        resultat = subprocess.run(
            ["bash", str(RACINE / "installer.sh"), "--avec-hints"],
            env=environnement,
            capture_output=True,
            text=True,
        )
        assert resultat.returncode == 0, resultat.stderr

    contenu = hints.read_text(encoding="utf-8")
    assert "Règles personnelles à conserver" in contenu, "le fichier existant a été écrasé"
    assert contenu.count("deepseek-horaires") == 1, "le bloc a été ajouté plusieurs fois"


def test_installeur_desinstallation_retire_les_liens_sans_toucher_aux_donnees(tmp_path):
    environnement = {
        "HOME": str(tmp_path),
        "XDG_CONFIG_HOME": str(tmp_path / ".config"),
        "PATH": "/usr/bin:/bin",
    }
    subprocess.run(["bash", str(RACINE / "installer.sh")], env=environnement, check=True, capture_output=True)
    resultat = subprocess.run(
        ["bash", str(RACINE / "installer.sh"), "--desinstaller"],
        env=environnement,
        capture_output=True,
        text=True,
    )
    assert resultat.returncode == 0, resultat.stderr
    for commande in COMMANDES:
        assert not (tmp_path / ".local" / "bin" / commande).exists()
    assert (RACINE / "data" / "en-attente.json").exists(), "les données ont été supprimées"


# --------------------------------------------------------------- application web


def test_manifeste_json_valide_et_complet():
    manifeste = json.loads((DOCS / "manifest.webmanifest").read_text(encoding="utf-8"))
    for cle in ("name", "short_name", "start_url", "scope", "display", "theme_color", "icons"):
        assert cle in manifeste, f"clé « {cle} » absente du manifeste"
    assert manifeste["display"] in ("standalone", "fullscreen", "minimal-ui")
    assert manifeste["lang"] == "fr"


def test_manifeste_declare_les_icones_requises():
    manifeste = json.loads((DOCS / "manifest.webmanifest").read_text(encoding="utf-8"))
    icones = {(icone["sizes"], icone.get("purpose", "any")) for icone in manifeste["icons"]}
    assert ("192x192", "any") in icones
    assert ("512x512", "any") in icones
    assert ("512x512", "maskable") in icones


def mesurer_png(chemin: Path) -> tuple:
    """Dimensions réelles lues dans l'en-tête IHDR du PNG."""
    donnees = chemin.read_bytes()
    assert donnees[:8] == b"\x89PNG\r\n\x1a\n", f"{chemin.name} n'est pas un PNG"
    largeur, hauteur = struct.unpack(">II", donnees[16:24])
    return largeur, hauteur


def test_icones_png_aux_bonnes_dimensions():
    for nom, attendu in (
        ("icone-192.png", (192, 192)),
        ("icone-512.png", (512, 512)),
        ("icone-maskable-512.png", (512, 512)),
    ):
        assert mesurer_png(DOCS / nom) == attendu, nom


def test_page_declare_le_manifeste_et_les_metadonnees_installables():
    page = (DOCS / "index.html").read_text(encoding="utf-8")
    assert 'rel="manifest" href="manifest.webmanifest"' in page
    assert 'name="theme-color"' in page
    assert 'apple-mobile-web-app-capable' in page
    assert 'id="bouton-installer"' in page


def test_service_worker_present_et_enregistre_par_la_page():
    worker = (DOCS / "sw.js").read_text(encoding="utf-8")
    assert "addEventListener(\"install\"" in worker
    assert "addEventListener(\"fetch\"" in worker
    assert "data/suivi.json" in worker, "les statistiques doivent être gérées hors ligne"

    application = (DOCS / "app.js").read_text(encoding="utf-8")
    assert 'navigator.serviceWorker.register("sw.js")' in application
    assert "beforeinstallprompt" in application


def test_fichiers_du_service_worker_reellement_publies():
    """Tout ce que la coquille met en cache doit exister dans docs/."""
    worker = (DOCS / "sw.js").read_text(encoding="utf-8")
    for nom in ("index.html", "style.css", "app.js", "manifest.webmanifest", "icone-192.png", "icone-512.png"):
        assert f'"./{nom}"' in worker, f"{nom} absent de la coquille du service worker"
        assert (DOCS / nom).is_file(), f"{nom} manquant dans docs/"


def test_page_utilisable_hors_ligne_avec_repli_sur_la_copie_locale():
    application = (DOCS / "app.js").read_text(encoding="utf-8")
    assert 'match("data/suivi.json")' in application, "pas de repli sur la copie locale des données"
    assert "hors ligne" in application
