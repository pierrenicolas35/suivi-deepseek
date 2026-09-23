# Suivi DeepSeek

Maîtrise des usages et de la consommation de l'API DeepSeek : heures pleines /
heures creuses, statistiques par application, et demandes différées en heures
creuses.

Tableau de bord : <https://pierrenicolas35.github.io/suivi-deepseek/>

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

`docs/` est publié sur GitHub Pages par `.github/workflows/pages.yml`. La page
est statique : elle lit `docs/data/suivi.json`.

- **Bandeau temps réel** : heures pleines/creuses calculées dans le navigateur,
  avec compte à rebours jusqu'à la bascule.
- **Indicateurs** : coût selon la grille officielle, part en heures pleines,
  économie possible, tokens, taux de cache (les tokens servis depuis le cache
  représentent ~97 % de la consommation chez moi), solde du compte.
- **Graphiques** : coût par jour (pleine/creuse), répartition par profil,
  par application, carte horaire `jour de semaine × heure UTC`.
- **Demandes en attente** : prompt exact à rejouer, application, heure de
  bascule, bouton « copier le prompt ».
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

## 7. Tests

```sh
python3 -m pytest tests -q      # 67 tests
```

Ils couvrent les bornes des fenêtres tarifaires (week-ends, jours fériés,
bascule), la grille de prix (remise creuse = moitié de la pleine, cache borné),
l'attribution des sessions, la file d'attente et la collecte sur une base
factice.

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
├── config/            tarifs.json, profils.json, jours_feries_cn.json
├── outils/            horaires.py, tarifs.py, sessions.py, differe.py, collecter.py, solde.py
├── bin/               deepseek-horaires, deepseek-differe, deepseek-collecter
├── data/              en-attente.json (file d'attente locale)
├── docs/              index.html, style.css, app.js, data/suivi.json (publié)
├── tests/             67 tests pytest
└── .github/workflows/ pages.yml (tests, contrôle des secrets, déploiement Pages)
```
