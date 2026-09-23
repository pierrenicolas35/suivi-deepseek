#!/usr/bin/env bash
# Installation du suivi DeepSeek sur une machine.
#
#   ./installer.sh                 installe les commandes (liens dans ~/.local/bin)
#   ./installer.sh --avec-hints    ajoute en plus la règle globale de Goose
#   ./installer.sh --desinstaller  retire les liens (les données sont conservées)
#
# L'application web (tableau de bord) est publiée par GitHub Pages : pour
# l'installer sur un téléphone ou un ordinateur, voir README § 10.
set -euo pipefail

RACINE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
BIN="${HOME}/.local/bin"
HINTS="${XDG_CONFIG_HOME:-$HOME/.config}/goose/.goosehints"
DEBUT_MARQUEUR="# >>> suivi-deepseek >>>"
FIN_MARQUEUR="# <<< suivi-deepseek <<<"
COMMANDES=(deepseek-horaires deepseek-differe deepseek-collecter)

avec_hints=0
desinstaller=0
for argument in "$@"; do
  case "$argument" in
    --avec-hints) avec_hints=1 ;;
    --desinstaller) desinstaller=1 ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $argument" >&2; exit 2 ;;
  esac
done

echo "== Suivi DeepSeek — installation depuis ${RACINE} =="

# ------------------------------------------------------------------ 1. retrait
if [ "$desinstaller" -eq 1 ]; then
  for commande in "${COMMANDES[@]}"; do
    if [ -L "${BIN}/${commande}" ]; then
      rm -f "${BIN}/${commande}"
      echo "   retiré : ${BIN}/${commande}"
    fi
  done
  echo "== Liens retirés. Le projet et ses données restent dans ${RACINE}. =="
  exit 0
fi

# ------------------------------------------------------------- 2. vérifications
echo "-- Vérifications"
if ! command -v python3 >/dev/null 2>&1; then
  echo "   python3 introuvable : installez-le (ex. sudo apt install python3)" >&2
  exit 1
fi

version_python="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
python3 - <<'PY' || { echo "   python3 ${version_python} est trop ancien (3.10 minimum)" >&2; exit 1; }
import sys
sys.exit(0 if sys.version_info >= (3, 10) else 1)
PY
echo "   python3 ${version_python} : ok"

for commande in "${COMMANDES[@]}"; do
  [ -f "${RACINE}/bin/${commande}" ] || { echo "   ${RACINE}/bin/${commande} manquant" >&2; exit 1; }
done
echo "   scripts bin/ : ok"

# ------------------------------------------------------------ 3. liens d'appel
echo "-- Commandes"
mkdir -p "${BIN}"
for commande in "${COMMANDES[@]}"; do
  chmod +x "${RACINE}/bin/${commande}"
  ln -sfn "${RACINE}/bin/${commande}" "${BIN}/${commande}"
  echo "   ${BIN}/${commande} -> ${RACINE}/bin/${commande}"
done

case ":${PATH}:" in
  *":${BIN}:"*) ;;
  *) echo "   ⚠ ${BIN} n'est pas dans le PATH : ajoutez « export PATH=\"\$HOME/.local/bin:\$PATH\" » à ~/.bashrc" ;;
esac

# ------------------------------------------------------------------ 4. auto-test
echo "-- Auto-test"
if "${BIN}/deepseek-horaires" --json >/dev/null 2>&1; then
  echo "   deepseek-horaires : ok"
else
  echo "   ⚠ deepseek-horaires n'a rien renvoyé : vérifiez ${RACINE}/outils/horaires.py" >&2
fi

# ------------------------------------------------- 5. règle globale de Goose
if [ "$avec_hints" -eq 1 ]; then
  echo "-- Règle globale Goose (${HINTS})"
  mkdir -p "$(dirname "${HINTS}")"
  if [ -f "${HINTS}" ] && grep -Fq "${DEBUT_MARQUEUR}" "${HINTS}"; then
    echo "   bloc déjà présent : inchangé (voir README § 3)"
  else
    cat >> "${HINTS}" <<'BLOC'

# >>> suivi-deepseek >>>
## Tarification DeepSeek : à annoncer au démarrage de chaque session

Avant toute autre action, exécute `deepseek-horaires` et affiche sa sortie telle
quelle sur la première ligne de ta réponse. Cette commande indique si l'API
DeepSeek est en HEURES PLEINES (tarif normal) ou en HEURES CREUSES (−50 %), avec
l'heure de bascule et le délai restant. Ne recalcule pas ces horaires toi-même.

Si nous sommes en heures pleines et que ma demande implique un vrai travail
(code, analyse, rédaction, tests, publication), demande-moi UNE SEULE FOIS si je
préfère différer en heures creuses (−50 %). Si je réponds oui, n'exécute pas la
demande : enregistre-la avec
`deepseek-differe ajouter --prompt "<ma demande>" --application "<projet>"`.

Tableau de bord : https://pierrenicolas35.github.io/suivi-deepseek/
Recharge du compte : https://platform.deepseek.com/top_up
# <<< suivi-deepseek <<<
BLOC
    echo "   règle ajoutée (bloc délimité par ${DEBUT_MARQUEUR})"
  fi
else
  echo "-- Règle globale Goose"
  if [ -f "${HINTS}" ] && grep -Fq "deepseek-horaires" "${HINTS}"; then
    echo "   déjà en place dans ${HINTS}"
  else
    echo "   absente : relancez avec --avec-hints pour l'ajouter (README § 3)"
  fi
fi

echo "== Terminé. Testez : deepseek-horaires =="
