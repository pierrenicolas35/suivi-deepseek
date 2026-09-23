"""Interface mobile : vues par type d'analyse, gestes de zoom, cohérence hors ligne."""

import re
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
DOCS = RACINE / "docs"

PAGE = (DOCS / "index.html").read_text(encoding="utf-8")
APPLICATION = (DOCS / "app.js").read_text(encoding="utf-8")
STYLES = (DOCS / "style.css").read_text(encoding="utf-8")
WORKER = (DOCS / "sw.js").read_text(encoding="utf-8")

VUES = ("synthese", "couts", "horaires", "repartition", "demandes")


def test_une_vue_et_un_onglet_par_type_d_analyse():
    for vue in VUES:
        assert f'id="vue-{vue}"' in PAGE, f"vue « {vue} » absente"
        assert f'data-onglet="{vue}"' in PAGE, f"onglet « {vue} » absent"
    assert PAGE.count('class="onglet"') == len(VUES), "la barre d'onglets ne compte pas cinq entrées"


def test_une_seule_vue_visible_au_chargement():
    sections = re.findall(r'<section class="vue"[^>]*>', PAGE)
    assert len(sections) == len(VUES)
    assert sum("hidden" in section for section in sections) == len(VUES) - 1


def test_navigation_par_onglets_et_par_adresse():
    assert "montrerOnglet" in APPLICATION
    assert "addEventListener(\"hashchange\"" in APPLICATION, "les vues ne sont pas adressables (#couts…)"
    assert "aria-selected" in APPLICATION, "l'onglet actif n'est pas annoncé"


def test_mise_en_page_pensee_pour_le_smartphone():
    assert "viewport-fit=cover" in PAGE, "encoche et barre d'état non gérées"
    assert "safe-area-inset-bottom" in STYLES, "la barre d'onglets passe sous la barre gestuelle"
    assert "safe-area-inset-top" in STYLES
    assert "@media (min-width" in STYLES


def test_barre_d_onglets_fixe_en_bas():
    bloc = re.search(r"\.onglets \{(.*?)\}", STYLES, re.S).group(1)
    assert "position: fixed" in bloc
    assert "bottom: 0" in bloc


def test_graphiques_zoomables_au_doigt_et_a_la_souris():
    for geste in ("pointerdown", "pointermove", "pointerup", "wheel", "dblclick"):
        assert geste in APPLICATION, f"geste « {geste} » non géré"
    assert "creerZoomX" in APPLICATION, "moteur de zoom absent"
    assert "Math.hypot" in APPLICATION, "le pincement à deux doigts n'est pas calculé"
    assert "touch-action: pan-y" in STYLES, "le glissement vertical de la page doit rester possible"
    for action in ("plus", "moins", "reset"):
        assert f'data-zoom-action="{action}"' in PAGE, f"bouton de zoom « {action} » absent"
    assert PAGE.count('data-zoom="jours"') == 1
    assert PAGE.count('data-zoom="thermique"') == 1


def test_graphiques_dessines_a_la_largeur_de_l_ecran():
    assert "clientWidth" in APPLICATION, "les graphiques ne s'adaptent pas à la largeur"
    assert "viewBox" in APPLICATION
    assert "clipPath" in APPLICATION, "les tracés ne sont pas coupés à la zone de tracé"
    assert 'addEventListener("resize"' in APPLICATION, "pas de redessin après rotation de l'écran"


def test_detail_au_toucher_pour_chaque_graphique():
    for panneau in ("detail-jours", "detail-thermique", "detail-profils"):
        assert f'id="{panneau}"' in PAGE, f"panneau de détail « {panneau} » absent"
    assert "onTap" in APPLICATION


def test_plus_de_tableau_html_dans_les_vues_mobiles():
    """Les tableaux larges sont remplacés par des listes de cartes."""
    assert "<table" not in PAGE
    assert "listeSessions" in APPLICATION


def test_cache_des_donnees_partage_entre_page_et_service_worker():
    version_application = re.search(r'caches\.open\("(suivi-deepseek-donnees-v\d+)"\)', APPLICATION)
    assert version_application, "la page n'enregistre pas la copie hors ligne des données"
    assert f'"{version_application.group(1)}"' in WORKER, "page et service worker utilisent deux caches différents"
