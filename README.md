# Suivi DeepSeek

Maîtrise des usages et de la consommation de l'API DeepSeek : heures pleines /
heures creuses, statistiques par application, et demandes différées en heures
creuses.

Tableau de bord : <https://pierrenicolas35.github.io/suivi-deepseek/>

Installation : `./installer.sh` pour les commandes sur une machine (§ 2), et
§ 10 pour installer l'application sur un téléphone ou un ordinateur.

## 1. Heures pleines, heures creuses

Règle officielle DeepSeek (<https://api-docs.deepseek.com/quick_start/pricing>) :

| Période | Quand | Tarif |
|---|---|---|
| **Pleines** | lundi → vendredi, `01:00-04:00` et `06:00-10:00` UTC (hors jours fériés chinois) | tarif normal |
| **Creuses** | toutes les autres heures : nuits, week-ends complets, jours fériés chinois complets | **−50 %** |

Exprimé en heure de Paris : pleines le lundi-vendredi de `03:00` à `06:00` et de
`08:00` à `12:00` (l'été ; décalage d'une heure en hiver).

La grille appliquée aux coûts de cette application est celle de
`config/tarifs.json` : `deepseek-flash` (cache hit `0,006`/`0,003`, cache miss
`0,30`/`0,15`, sortie `1,20`/`0,60` $ par million de tokens, pleine/creuse) et
`deepseek-v4-pro`.

## 2. Commandes

`./installer.sh` crée les liens dans `~/.local/bin` et vérifie que tout répond
(`--avec-hints` ajoute en plus la règle globale de Goose, `--desinstaller` retire
les liens sans toucher aux données).

| Commande | Rôle |
|---|---|
| `deepseek-horaires` | état courant (pleine/creuse), heure de bascule, délai restant (`--json` pour du machine-readable) |
| `deepseek-differe ajouter --prompt "…" --application "…"` | met une demande en attente d'heures creuses |
| `deepseek-differe liste` | affiche la file d'attente |
| `deepseek-differe executer <id>` / `annuler <id>` | clôt une demande différée |
| `deepseek-collecter` | recalcule `docs/data/suivi.json` depuis la base de sessions goose |

Les mêmes points d'entrée existent dans `bin/` et sont liés dans
`~/.local/bin/`, donc utilisables depuis n'importe quel profil.

## 3. Au démarrage de chaque session goose

Le fichier global `~/.config/goose/.goosehints` (voir la
[documentation des hints](https://goose-docs.ai/docs/guides/context-engineering/using-goosehints))
demande à goose :

1. d'exécuter `deepseek-horaires` et d'afficher l'état pleine/creuse avant toute
   autre action ;
2. si nous sommes en heures pleines, de demander **une fois** si la demande doit
   être différée (−50 %) ;
3. si oui, de l'enregistrer avec `deepseek-differe ajouter` au lieu de
   l'exécuter.

Ce fichier étant global, la règle s'applique à tous les profils et à tous les
dossiers de travail.

## 4. Tableau de bord

`docs/` est publié sur GitHub Pages par `.github/workflows/pages.yml`. Les pages
sont statiques : elles lisent `docs/data/suivi.json`. C'est aussi une
**application installable** (manifeste + service worker, voir § 10).

L'interface est **claire (fond blanc)** et conçue pour un **usage au téléphone,
d'une seule main**. La navigation se fait par le **menu** : le bouton ☰ ouvre la
liste des analyses, et chaque entrée mène à **sa propre page**. Le menu et les
liens sont du HTML/CSS pur (une case à cocher pilote l'ouverture) : la
circulation entre les écrans ne dépend donc d'aucun script.

| Page | Contenu |
|---|---|
| **Accueil** (`index.html`) | état pleine/creuse, indicateurs clés, 7 derniers jours, solde, recharge |
| **Coûts** (`couts.html`) | coût par jour en barres empilées ou en cumul (zoomable), repères : moyenne, projection 30 jours |
| **Horaires** (`horaires.html`) | compte à rebours, carte horaire `jour × heure UTC`, créneaux les plus coûteux |
| **Répartition** (`repartition.html`) | donut par profil, barres par application, sessions récentes |
| **Demandes** (`demandes.html`) | file d'attente des demandes différées et demandes déjà clôturées |

Tout est présenté en cartes (aucun tableau à faire défiler latéralement) avec
des cibles tactiles d'au moins 44 px et la gestion de l'encoche (`safe-area`).
Le bandeau d'état tarifaire et le compte à rebours restent visibles en haut de
chaque page ; le pied de page indique la version de l'interface, utile pour
vérifier qu'un téléphone n'affiche pas une copie ancienne.

### Graphiques interactifs

- **Glisser** horizontalement : parcourir la période.
- **Pincer à deux doigts** : zoomer ; boutons − / + / ⤢ équivalents pour ceux qui
  préfèrent, et molette sur ordinateur.
- **Double-tap** : tout réafficher.
- **Toucher** une barre, une case ou une part : le détail s'affiche sous le
  graphique (coût pleine/creuse, requêtes, tokens) ; le résumé de la période
  visible revient dès qu'on zoome.
- Le défilement vertical de la page reste possible même si le doigt part d'un
  graphique.

Les totaux affichés sous les graphiques suivent la fenêtre visible : zoomer sur
trois jours affiche le total de ces trois jours.

- **Demandes en attente** : prompt exact à rejouer, application, heure de
  bascule, bouton « copier le prompt », et historique des demandes clôturées.
- **Lien de recharge** : <https://platform.deepseek.com/top_up> (en-tête, cartes
  et demandes en attente).

## 5. Attribution des sessions aux applications

`config/profils.json` associe chaque session goose à un **profil**
(`Hermès / Planning`, `Apps GitHub`, `Goose & divers`) et à une **application**
(`hdjverif`, `tiny-print`, `hermes-planning`…). Ordre de priorité :

1. motif sur le nom de la session (`hdj`, `planning`, `tiny-print`…) ;
2. sinon, dépôt GitHub cité dans les messages de la session (liste
   `depots_ignores` pour écarter les dépôts techniques) ;
3. sinon, `Divers`.

Pour ajouter un projet : compléter les listes `profils` et `apps`, puis relancer
`deepseek-collecter`.

## 6. Données et confidentialité

- La base goose (`~/.local/share/goose/sessions/sessions.db`) est lue **en
  lecture seule** (`mode=ro`), jamais modifiée.
- Le solde est interrogé côté machine (`GET https://api.deepseek.com/user/balance`)
  avec la clé lue dans `DEEPSEEK_API_KEY` ou `~/.config/goose/secrets.yaml`.
- Seuls des agrégats sont publiés : aucune clé d'API, aucun contenu de
  conversation, aucun chemin sensible. Le workflow échoue si
  `docs/data/suivi.json` contient une chaîne ressemblant à un secret.
- La page est publique et non indexable (`robots.txt`, `noindex`). Les coûts
  affichés sont sensibles mais sans secret : si tu préfères, rends le dépôt privé
  (GitHub Pages sur dépôt privé nécessite un compte payant).
- Une fois l'application installée (§ 10), le navigateur conserve sur l'appareil
  une copie locale de la page et des derniers agrégats publiés, pour l'afficher
  hors ligne. Elle est signalée « hors ligne : dernière copie connue » et se met
  à jour dès la prochaine connexion. La désinstaller efface cette copie.

## 7. Tests

```sh
python3 -m pytest tests -q      # 92 tests
```

Ils couvrent les bornes des fenêtres tarifaires (week-ends, jours fériés,
bascule), la grille de prix (remise creuse = moitié de la pleine, cache borné),
l'attribution des sessions, la file d'attente, la collecte sur une base factice,
l'installation (liens des commandes, manifeste et icônes de l'application
installable) et l'interface téléphone (une page par analyse, navigation par menu
sans script, thème clair, gestes de zoom, redessin à la largeur de l'écran,
cache hors ligne).

## 8. Limites connues

- Les jours fériés chinois ne sont pas devinés : renseigner
  `config/jours_feries_cn.json` (`{"dates": ["2027-02-06", …]}`) pour que les
  fêtes chinoises soient bien facturées en heures creuses.
- Le coût affiché pour les heures pleines est un **recalcul** avec la grille
  officielle : l'estimation enregistrée par goose dans `usage_ledger`
  correspond au tarif creux (soit la moitié), elle sous-estime donc les heures
  pleines.
- Le solde n'est rafraîchi qu'à chaque exécution de `deepseek-collecter`.

## 9. Arborescence

```
suivi-deepseek/
├── installer.sh       installation des commandes (et de la règle globale de Goose)
├── config/            tarifs.json, profils.json, jours_feries_cn.json
├── outils/            horaires.py, tarifs.py, sessions.py, differe.py, collecter.py, solde.py
├── bin/               deepseek-horaires, deepseek-differe, deepseek-collecter
├── data/              en-attente.json (file d'attente locale)
├── docs/              index.html, couts.html, horaires.html, repartition.html,
│                      demandes.html (publié), style.css, app.js, data/suivi.json
│                      manifest.webmanifest, sw.js, icone-*.png (application installable)
├── tests/             tests pytest
└── .github/workflows/ pages.yml (tests, contrôle des secrets, déploiement Pages)
```

## 10. Installer l'application

Le tableau de bord est une application web installable (PWA) pensée pour le
téléphone (§ 4) : une fois installée, elle s'ouvre en plein écran depuis son
icône, sans barre d'adresse, et reste consultable hors ligne (dernière copie
connue, clairement signalée).

**Ordinateur (Chrome, Edge, Brave)** — sur
<https://pierrenicolas35.github.io/suivi-deepseek/> :

1. cliquer sur l'icône d'installation dans la barre d'adresse, ou passer par le
   menu ⋮ → *Installer Suivi DeepSeek* (Cast, enregistrer et partager →
   *Installer la page en tant qu'application*) ;
2. valider : l'application apparaît dans les applications du système.

Un bouton **« Installer l'application »** apparaît aussi dans l'en-tête de la
page dès que le navigateur le permet.

**iPhone / iPad (Safari)** : bouton *Partager* → *Sur l'écran d'accueil* →
*Ajouter*. (Safari n'autorise pas l'installation en un clic : c'est le bouton
« Installer sur l'écran d'accueil » de la page qui rappelle la marche à suivre.)

**Android (Chrome)** : menu ⋮ → *Ajouter à l'écran d'accueil* /
*Installer l'application*.

Pour retirer l'application : la désinstaller depuis l'écran d'accueil ou les
applications du système, ou la retirer de `chrome://apps`. Les statistiques
publiées proviennent toujours de `deepseek-collecter` exécuté sur la machine :
l'application installée n'est qu'un afficheur.
