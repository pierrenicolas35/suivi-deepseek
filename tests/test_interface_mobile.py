"""Interface téléphone : pages par type d'analyse, menu, thème clair, graphiques zoomables."""

import re
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
DOCS = RACINE / "docs"

PAGES = ("index", "couts", "horaires", "repartition", "demandes")
STYLES = (DOCS / "style.css").read_text(encoding="utf-8")
APPLICATION = (DOCS / "app.js").read_text(encoding="utf-8")
WORKER = (DOCS / "sw.js").read_text(encoding="utf-8")

PAGES_HTML = {page: (DOCS / f"{page}.html").read_text(encoding="utf-8") for page in PAGES}


def test_une_page_par_type_d_analyse():
    for page in PAGES:
        assert (DOCS / f"{page}.html").is_file(), f"{page}.html manquant"
        assert f'data-page="{page}"' in PAGES_HTML[page], f"{page}.html ne déclare pas sa page"


def test_navigation_par_menu_avec_des_liens_natifs():
    """Le menu doit être fait de vrais liens : aucune navigation dépendant du script."""
    for page, html in PAGES_HTML.items():
        for cible in PAGES:
            assert f'href="{cible}.html"' in html, f"{page}.html ne renvoie pas vers {cible}.html"
        assert 'class="menu"' in html and 'class="menu-liste"' in html
        assert 'aria-current="page"' in html, f"{page}.html ne marque pas la page courante"


def test_menu_ouvrable_sans_script():
    """L'ouverture du menu repose sur une case à cocher stylée en CSS."""
    assert 'type="checkbox" id="bascule-menu"' in PAGES_HTML["index"]
    assert ".bascule:checked ~ .menu" in STYLES, "le menu ne s'ouvre pas en CSS pur"
    assert PAGES_HTML["index"].index('id="bascule-menu"') < PAGES_HTML["index"].index('class="menu"')


def test_chaque_page_a_un_retour_et_un_rafraichissement_natifs():
    for page, html in PAGES_HTML.items():
        assert 'class="bouton-menu"' in html, f"{page}.html n'a pas de bouton menu"
        assert 'href=""' in html, f"{page}.html n'a pas de lien d'actualisation"


def test_theme_clair_sur_fond_blanc():
    entete = STYLES[STYLES.index(":root {") : STYLES.index("}", STYLES.index(":root {"))]
    assert "color-scheme: light" in entete, "le thème clair n'est pas déclaré"
    assert "--carte: #ffffff" in entete, "les cartes ne sont pas blanches"
    assert "--fond: #f4f6fb" in entete, "le fond n'est pas clair"
    assert "--texte: #0f172a" in entete, "le texte doit être foncé sur fond clair"
    # Aucune des anciennes couleurs sombres ne doit subsister.
    for sombre in ("#0b1220", "#121c2f", "#16223a", "#1c2740"):
        assert sombre not in STYLES, f"couleur sombre {sombre} encore présente"


def test_pages_et_manifeste_en_theme_clair():
    for page, html in PAGES_HTML.items():
        assert 'name="color-scheme" content="light"' in html, f"{page}.html n'annonce pas le thème clair"
        assert 'name="theme-color" content="#ffffff"' in html, f"{page}.html n'a pas de barre blanche"
    manifeste = (DOCS / "manifest.webmanifest").read_text(encoding="utf-8")
    assert '"theme_color": "#ffffff"' in manifeste
    assert '"background_color": "#f4f6fb"' in manifeste


def test_graphiques_colores_depuis_la_feuille_de_style():
    """Les graphiques suivent le thème : leur palette est lue dans le CSS."""
    assert "getComputedStyle" in APPLICATION
    assert "palette()" in APPLICATION
    for variable in ("--pleine", "--creuse", "--grille", "--case-vide"):
        assert variable in APPLICATION, f"{variable} non lue depuis le thème"


def test_solde_et_date_de_collecte_en_haut_de_chaque_page():
    """Le solde et la date de dernière collecte sont en tête de toutes les pages."""
    for page, html in PAGES_HTML.items():
        contenu = html[html.index("<main") : html.index("</main>")]
        assert 'id="solde-hero"' in contenu, f"{page}.html n'affiche pas le solde en haut"
        assert 'id="solde-montant"' in contenu, f"{page}.html n'a pas le montant du solde"
        assert 'id="solde-maj"' in contenu, f"{page}.html n'affiche pas la date de mise à jour"
        # Le bandeau doit précéder tout le reste du contenu.
        for autre in ('class="panneau"', 'class="grille-cartes"', 'class="segments"'):
            if autre in contenu:
                assert contenu.index('id="solde-hero"') < contenu.index(autre), (
                    f"sur {page}.html, le solde n'est pas en tête"
                )


def test_le_solde_est_rempli_et_le_doublon_supprime():
    assert "majSolde" in APPLICATION
    assert "solde.genere_le" in APPLICATION or "donnees.genere_le" in APPLICATION
    assert "Données mises à jour le" in APPLICATION, "la date de collecte n'est pas affichée en haut"
    assert 'titre: "Solde du compte"' not in APPLICATION, "le solde est encore répété dans la grille d'indicateurs"


def test_selecteur_barres_cumul_cable():
    """Régression : le sélecteur doit écouter les clics, pas seulement s'afficher."""
    assert "preparerSegments" in APPLICATION, "le sélecteur Barres/Cumul n'est pas câblé"
    assert 'segment.getAttribute("data-mode")' in APPLICATION
    assert 'data-mode="barres"' in PAGES_HTML["couts"]
    assert 'data-mode="cumul"' in PAGES_HTML["couts"]


def test_version_de_l_interface_coherente_entre_pages_et_script():
    """Une page ancienne servie en cache est détectée et rechargée (pas de mélange)."""
    version = re.search(r"^const VERSION = (\d+);", APPLICATION, re.M)
    assert version, "la version de l'interface n'est pas déclarée dans app.js"
    for page, html in PAGES_HTML.items():
        assert f'data-version="{version.group(1)}"' in html, f"{page}.html n'annonce pas la version {version.group(1)}"
        assert f"style.css?v={version.group(1)}" in html, f"{page}.html ne versionne pas sa feuille de style"
        assert f"app.js?v={version.group(1)}" in html, f"{page}.html ne versionne pas son script"
    assert "verifierVersionPage" in APPLICATION, "aucune détection de page périmée"


def test_bouton_de_mise_a_jour_de_secours():
    """Sur téléphone, un cache récalcitrant doit pouvoir être vidé sans outil externe."""
    assert "forcerMiseAJour" in APPLICATION
    assert "caches.delete" in APPLICATION, "le bouton ne vide pas les caches"
    assert "unregister" in APPLICATION, "le bouton ne désinscrit pas le service worker"
    for page, html in PAGES_HTML.items():
        assert 'id="bouton-maj"' in html, f"{page}.html n'a pas de bouton de mise à jour"


def test_graphiques_zoomables_au_doigt_et_a_la_souris():
    for geste in ("pointerdown", "pointermove", "pointerup", "wheel", "dblclick"):
        assert geste in APPLICATION, f"geste « {geste} » non géré"
    assert "creerZoomX" in APPLICATION, "moteur de zoom absent"
    assert "Math.hypot" in APPLICATION, "le pincement à deux doigts n'est pas calculé"
    assert "touch-action: pan-y" in STYLES, "le glissement vertical de la page doit rester possible"
    for action in ("plus", "moins", "reset"):
        assert f'data-zoom-action="{action}"' in PAGES_HTML["couts"]
        assert f'data-zoom-action="{action}"' in PAGES_HTML["horaires"]


def test_graphiques_dessines_a_la_largeur_de_l_ecran():
    assert "clientWidth" in APPLICATION, "les graphiques ne s'adaptent pas à la largeur"
    assert "viewBox" in APPLICATION
    assert "clipPath" in APPLICATION, "les tracés ne sont pas coupés à la zone de tracé"
    assert 'addEventListener("resize"' in APPLICATION, "pas de redessin après rotation de l'écran"


def test_detail_au_toucher_pour_chaque_graphique():
    for panneau in ("detail-jours", "detail-thermique", "detail-profils"):
        assert f'id="{panneau}"' in PAGES_HTML["couts"] + PAGES_HTML["horaires"] + PAGES_HTML["repartition"]
    assert "onTap" in APPLICATION


def test_plus_de_tableau_html_dans_les_pages():
    """Sur téléphone, les tableaux larges sont remplacés par des listes de cartes."""
    for page, html in PAGES_HTML.items():
        assert "<table" not in html, f"{page}.html contient encore un tableau"


def test_toutes_les_pages_sont_disponibles_hors_ligne():
    for page in PAGES:
        assert f'"./{page}.html"' in WORKER, f"{page}.html absent de la coquille du service worker"


def test_cache_des_donnees_partage_entre_page_et_service_worker():
    nom = re.search(r'const CACHE_DONNEES = "([^"]+)"', APPLICATION)
    assert nom, "la page ne nomme pas le cache de la copie hors ligne"
    assert f'"{nom.group(1)}"' in WORKER, "page et service worker utilisent deux caches différents"


def test_les_anciens_caches_sont_purges_a_la_mise_a_jour():
    """Cœur du problème rencontré : une copie ancienne ne doit jamais resservir."""
    assert 'cle.startsWith("suivi-deepseek-")' in WORKER, "la purge ne couvre pas tous les caches de l'application"
    assert "caches.delete(cle)" in WORKER
    assert "caches.open(CACHE_DONNEES)" in APPLICATION, "la copie hors ligne n'est pas lue dans le cache en vigueur"
