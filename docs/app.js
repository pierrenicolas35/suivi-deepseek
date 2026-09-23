/* Tableau de bord « Suivi DeepSeek » — page statique, aucune dépendance externe. */
"use strict";

const FENETRES_PLEINES = [
  [1, 4],
  [6, 10],
]; // lundi-vendredi, heures UTC
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const JOURS_COURTS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
const COULEUR_PLEINE = "#f59e0b";
const COULEUR_CREUSE = "#22c55e";
const LARGEUR = 900;

let donnees = null;
let joursFeries = new Set();

/* ------------------------------------------------------------------ formats */

const dollar = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const dollarCompact = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});
const entier = new Intl.NumberFormat("fr-FR");
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

const fmtDollar = (v) => `${dollarCompact.format(v || 0)} $`;
const fmtDollarPrecis = (v) => `${dollar.format(v || 0)} $`;
const fmtTokens = (v) => compact.format(v || 0);
const fmtEntier = (v) => entier.format(v || 0);

function fmtDateHeure(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtDateJour(iso) {
  const [, mois, jour] = (iso || "").split("-");
  return `${jour}/${mois}`;
}

function fmtDuree(ms) {
  const secondes = Math.max(0, Math.floor(ms / 1000));
  const j = Math.floor(secondes / 86400);
  const h = Math.floor((secondes % 86400) / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  const s = secondes % 60;
  if (j) return `${j} j ${h} h ${String(m).padStart(2, "0")} min`;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}

/* ------------------------------------------------------- heures pleines/creuses */

function estHeurePleine(moment) {
  const jour = moment.getUTCDay();
  if (jour === 0 || jour === 6) return false;
  if (joursFeries.has(moment.toISOString().slice(0, 10))) return false;
  const heure = moment.getUTCHours();
  return FENETRES_PLEINES.some(([debut, fin]) => heure >= debut && heure < fin);
}

function prochaineBascule(depuis) {
  const etat = estHeurePleine(depuis);
  const curseur = new Date(depuis.getTime());
  curseur.setUTCSeconds(0, 0);
  for (let i = 0; i < 10 * 24 * 60; i += 1) {
    curseur.setUTCMinutes(curseur.getUTCMinutes() + 1);
    if (estHeurePleine(curseur) !== etat) return { moment: curseur, devientPleine: !etat };
  }
  return { moment: curseur, devientPleine: !etat };
}

function horodatageFr(moment) {
  const jour = JOURS[moment.getDay()].slice(0, 3);
  const heures = moment.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const date = moment.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  return `${jour}. ${date} ${heures}`;
}

function rendreHorloge() {
  const pastille = document.getElementById("pastille-horaire");
  const maintenant = new Date();
  const pleine = estHeurePleine(maintenant);
  const { moment, devientPleine } = prochaineBascule(maintenant);

  pastille.className = `pastille ${pleine ? "pleine" : "creuse"}`;
  pastille.innerHTML =
    (pleine ? "⏰ HEURES PLEINES" : "🌙 HEURES CREUSES") +
    ` <small>${devientPleine ? "pleines" : "creuses"} à ${horodatageFr(moment)} — dans ${fmtDuree(
      moment - maintenant
    )}</small>`;

  const bandeau = document.getElementById("bandeau");
  bandeau.classList.remove("erreur");
  if (pleine) {
    const creux = prochaineBascule(maintenant);
    const debutCreux = creux.devientPleine ? prochaineBascule(moment).moment : moment;
    bandeau.className = "bandeau alerte";
    bandeau.innerHTML =
      `<strong>⏰ Heures pleines</strong> — DeepSeek facture le tarif normal jusqu'à ` +
      `<strong>${horodatageFr(debutCreux)}</strong> (${fmtDuree(debutCreux - maintenant)}). ` +
      `Pour économiser 50 %, dites simplement <strong>« diffère »</strong> à Goose après votre demande : ` +
      `elle sera enregistrée ici et rejouable en heures creuses.`;
  } else {
    const prochaineCreuseDans = moment - maintenant;
    bandeau.className = "bandeau creuse";
    bandeau.innerHTML =
      `<strong>🌙 Heures creuses</strong> — remise de 50 % appliquée sur tous les tokens. ` +
      `Retour au tarif normal dans <strong>${fmtDuree(prochaineCreuseDans)}</strong> ` +
      `(${horodatageFr(moment)}). C'est le bon moment pour lancer les demandes différées.`;
  }
}

/* --------------------------------------------------------------- SVG utilitaires */

const NS = "http://www.w3.org/2000/svg";

function svg(attrs = {}) {
  const noeud = document.createElementNS(NS, "svg");
  for (const [cle, valeur] of Object.entries(attrs)) noeud.setAttribute(cle, String(valeur));
  return noeud;
}

function balise(nom, attrs = {}, texte) {
  const noeud = document.createElementNS(NS, nom);
  for (const [cle, valeur] of Object.entries(attrs)) noeud.setAttribute(cle, String(valeur));
  if (texte !== undefined) noeud.textContent = texte;
  return noeud;
}

function titre() {
  return balise("title");
}

function infobulle(parent, texte) {
  const t = titre();
  t.textContent = texte;
  parent.appendChild(t);
}

function maxDe(liste, cle) {
  return liste.reduce((acc, item) => Math.max(acc, cle(item)), 0);
}

/* --------------------------------------------------------------- graphiques */

function graphiqueJours(jours) {
  const conteneur = document.getElementById("graphique-jours");
  conteneur.innerHTML = "";
  if (!jours.length) {
    conteneur.textContent = "Aucune donnée.";
    return;
  }
  const hauteur = 300;
  const marges = { haut: 18, bas: 34, gauche: 58, droite: 12 };
  const largeurUtile = LARGEUR - marges.gauche - marges.droite;
  const hauteurUtile = hauteur - marges.haut - marges.bas;
  const maximum = Math.max(maxDe(jours, (j) => j.cout_officiel), 0.01);
  const pas = largeurUtile / jours.length;
  const largeurBarre = Math.max(6, Math.min(46, pas * 0.62));

  const racine = svg({ viewBox: `0 0 ${LARGEUR} ${hauteur}`, height: hauteur, role: "img" });

  for (let i = 0; i <= 4; i += 1) {
    const y = marges.haut + (hauteurUtile * i) / 4;
    const valeur = maximum * (1 - i / 4);
    racine.appendChild(
      balise("line", {
        x1: marges.gauche,
        x2: LARGEUR - marges.droite,
        y1: y,
        y2: y,
        stroke: "#24324a",
        "stroke-dasharray": i === 4 ? "0" : "3 5",
      })
    );
    racine.appendChild(
      balise(
        "text",
        { x: marges.gauche - 8, y: y + 4, fill: "#93a3bd", "font-size": 11, "text-anchor": "end" },
        fmtDollar(valeur)
      )
    );
  }

  jours.forEach((jour, index) => {
    const x = marges.gauche + index * pas + (pas - largeurBarre) / 2;
    let cumul = 0;
    for (const [cle, couleur] of [
      ["cout_creuse", COULEUR_CREUSE],
      ["cout_pleine", COULEUR_PLEINE],
    ]) {
      const valeur = jour[cle] || 0;
      if (valeur <= 0) continue;
      const hauteurBarre = (valeur / maximum) * hauteurUtile;
      const y = marges.haut + hauteurUtile - cumul - hauteurBarre;
      const rect = balise("rect", {
        x,
        y,
        width: largeurBarre,
        height: Math.max(hauteurBarre, 1),
        rx: 4,
        fill: couleur,
        opacity: 0.9,
      });
      infobulle(
        rect,
        `${jour.date} — ${cle === "cout_pleine" ? "heures pleines" : "heures creuses"} : ${fmtDollarPrecis(
          valeur
        )}`
      );
      racine.appendChild(rect);
      cumul += hauteurBarre;
    }
    racine.appendChild(
      balise(
        "text",
        {
          x: x + largeurBarre / 2,
          y: hauteur - 12,
          fill: "#93a3bd",
          "font-size": 11,
          "text-anchor": "middle",
        },
        fmtDateJour(jour.date)
      )
    );
  });

  conteneur.appendChild(racine);
}

function graphiqueDonut(profils) {
  const conteneur = document.getElementById("graphique-profils");
  const legende = document.getElementById("legende-profils");
  conteneur.innerHTML = "";
  legende.innerHTML = "";

  const total = profils.reduce((acc, p) => acc + p.cout_officiel, 0);
  const taille = 240;
  const rayon = 84;
  const circonference = 2 * Math.PI * rayon;
  const racine = svg({ viewBox: `0 0 ${taille} ${taille}`, height: taille });

  racine.appendChild(
    balise("circle", {
      cx: taille / 2,
      cy: taille / 2,
      r: rayon,
      fill: "none",
      stroke: "#1c2740",
      "stroke-width": 26,
    })
  );

  let decalage = 0;
  profils.forEach((profil) => {
    const part = total ? profil.cout_officiel / total : 0;
    const arc = balise("circle", {
      cx: taille / 2,
      cy: taille / 2,
      r: rayon,
      fill: "none",
      stroke: profil.couleur,
      "stroke-width": 26,
      "stroke-dasharray": `${(part * circonference).toFixed(2)} ${circonference.toFixed(2)}`,
      "stroke-dashoffset": (-decalage * circonference).toFixed(2),
      transform: `rotate(-90 ${taille / 2} ${taille / 2})`,
    });
    infobulle(arc, `${profil.nom} : ${fmtDollarPrecis(profil.cout_officiel)} (${(part * 100).toFixed(1)} %)`);
    racine.appendChild(arc);
    decalage += part;
  });

  racine.appendChild(
    balise(
      "text",
      { x: taille / 2, y: taille / 2 - 6, fill: "#93a3bd", "font-size": 12, "text-anchor": "middle" },
      "Total"
    )
  );
  racine.appendChild(
    balise(
      "text",
      {
        x: taille / 2,
        y: taille / 2 + 20,
        fill: "#e6ecf5",
        "font-size": 22,
        "font-weight": 700,
        "text-anchor": "middle",
      },
      fmtDollar(total)
    )
  );
  conteneur.appendChild(racine);

  profils.forEach((profil) => {
    const part = total ? (profil.cout_officiel / total) * 100 : 0;
    const item = document.createElement("span");
    item.innerHTML = `<i style="background:${profil.couleur}"></i>${profil.nom} — ${part.toFixed(1)} % (${fmtDollar(
      profil.cout_officiel
    )}, ${fmtEntier(profil.sessions)} sessions)`;
    legende.appendChild(item);
  });
}

function graphiqueApplications(applications) {
  const conteneur = document.getElementById("graphique-applications");
  conteneur.innerHTML = "";
  if (!applications.length) {
    conteneur.textContent = "Aucune donnée.";
    return;
  }
  const lignes = applications.slice(0, 12);
  const hauteurLigne = 34;
  const hauteur = lignes.length * hauteurLigne + 26;
  const margeGauche = 210;
  const largeurUtile = LARGEUR - margeGauche - 120;
  const maximum = Math.max(maxDe(lignes, (a) => a.cout_officiel), 0.001);
  const racine = svg({ viewBox: `0 0 ${LARGEUR} ${hauteur}`, height: hauteur });

  lignes.forEach((application, index) => {
    const y = 14 + index * hauteurLigne;
    racine.appendChild(
      balise(
        "text",
        {
          x: margeGauche - 12,
          y: y + 15,
          fill: "#e6ecf5",
          "font-size": 12.5,
          "text-anchor": "end",
        },
        application.nom.length > 26 ? `${application.nom.slice(0, 25)}…` : application.nom
      )
    );

    let cumul = 0;
    for (const [cle, couleur, libelle] of [
      ["cout_creuse", COULEUR_CREUSE, "heures creuses"],
      ["cout_pleine", COULEUR_PLEINE, "heures pleines"],
    ]) {
      const valeur = application[cle] || 0;
      if (valeur <= 0) continue;
      const largeur = Math.max((valeur / maximum) * largeurUtile, 1.5);
      const rect = balise("rect", {
        x: margeGauche + cumul,
        y: y + 3,
        width: largeur,
        height: 20,
        rx: 4,
        fill: couleur,
        opacity: 0.92,
      });
      infobulle(
        rect,
        `${application.nom} — ${libelle} : ${fmtDollarPrecis(valeur)} · ${application.profil}`
      );
      racine.appendChild(rect);
      cumul += largeur;
    }

    racine.appendChild(
      balise(
        "text",
        {
          x: margeGauche + cumul + 10,
          y: y + 18,
          fill: "#93a3bd",
          "font-size": 12,
        },
        `${fmtDollar(application.cout_officiel)} · ${fmtEntier(application.requetes)} req.`
      )
    );
  });

  conteneur.appendChild(racine);
}

function carteThermique(cellules) {
  const conteneur = document.getElementById("carte-thermique");
  conteneur.innerHTML = "";
  if (!cellules.length) {
    conteneur.textContent = "Aucune donnée.";
    return;
  }
  const largeurCellule = 30;
  const hauteurCellule = 26;
  const margeGauche = 44;
  const margeHaut = 20;
  const largeur = margeGauche + 24 * largeurCellule + 6;
  const hauteur = margeHaut + 7 * hauteurCellule + 10;
  const maximum = Math.max(...cellules.map((c) => c.cout), 0.0001);
  const racine = svg({ viewBox: `0 0 ${largeur} ${hauteur}`, height: hauteur });

  for (let heure = 0; heure < 24; heure += 1) {
    if (heure % 3 !== 0) continue;
    racine.appendChild(
      balise(
        "text",
        {
          x: margeGauche + heure * largeurCellule + largeurCellule / 2,
          y: 12,
          fill: "#93a3bd",
          "font-size": 10,
          "text-anchor": "middle",
        },
        `${String(heure).padStart(2, "0")}h`
      )
    );
  }

  for (let jour = 0; jour < 7; jour += 1) {
    const ordre = [1, 2, 3, 4, 5, 6, 0][jour];
    racine.appendChild(
      balise(
        "text",
        {
          x: margeGauche - 8,
          y: margeHaut + jour * hauteurCellule + 17,
          fill: "#93a3bd",
          "font-size": 10.5,
          "text-anchor": "end",
        },
        JOURS_COURTS[ordre]
      )
    );
    for (let heure = 0; heure < 24; heure += 1) {
      const cellule = cellules.find((c) => c.jour === ordre && c.heure_utc === heure);
      const cout = cellule ? cellule.cout : 0;
      const intensite = Math.min(1, Math.sqrt(cout / maximum));
      const rect = balise("rect", {
        x: margeGauche + heure * largeurCellule,
        y: margeHaut + jour * hauteurCellule,
        width: largeurCellule - 3,
        height: hauteurCellule - 3,
        rx: 4,
        fill: intensite === 0 ? "#16223a" : `rgba(56, 189, 248, ${0.12 + intensite * 0.85})`,
      });
      const pleine = cellule ? cellule.pleine : FENETRES_PLEINES.some(([a, b]) => heure >= a && heure < b);
      if (pleine && ordre !== 0 && ordre !== 6) {
        rect.setAttribute("stroke", COULEUR_PLEINE);
        rect.setAttribute("stroke-width", 1.4);
      }
      infobulle(
        rect,
        `${JOURS[ordre]} ${String(heure).padStart(2, "0")}h UTC${pleine ? " — heures pleines" : " — heures creuses"} : ${fmtDollarPrecis(
          cout
        )}${cellule ? ` · ${fmtEntier(cellule.requetes)} requêtes` : ""}`
      );
      racine.appendChild(rect);
    }
  }

  conteneur.appendChild(racine);
}

/* ------------------------------------------------------------------- sections */

function cartes(totaux, solde) {
  const conteneur = document.getElementById("cartes");
  const grille = [
    {
      titre: "Coût total (grille officielle)",
      valeur: fmtDollar(totaux.cout_officiel),
      detail: `${fmtEntier(totaux.requetes)} requêtes · estimation goose : ${fmtDollar(totaux.cout_goose)}`,
    },
    {
      titre: "Dont heures pleines",
      valeur: fmtDollar(totaux.cout_officiel_pleine),
      detail: `${(totaux.part_pleine * 100).toFixed(1)} % de la dépense · ${fmtDollar(
        totaux.economie_possible
      )} économisables en différant`,
      classe: "pleine",
    },
    {
      titre: "Dont heures creuses",
      valeur: fmtDollar(totaux.cout_officiel_creuse),
      detail: `remise de 50 % appliquée`,
      classe: "creuse",
    },
    {
      titre: "Économie potentielle",
      valeur: fmtDollar(totaux.economie_possible),
      detail: "si tout le trafic en heures pleines était reporté",
    },
    {
      titre: "Tokens consommés",
      valeur: fmtTokens(totaux.tokens_total),
      detail: `entrée ${fmtTokens(totaux.tokens_entree)} · sortie ${fmtTokens(
        totaux.tokens_sortie
      )} · ${((totaux.taux_cache || 0) * 100).toFixed(1)} % servis depuis le cache`,
    },
    {
      titre: "Solde du compte",
      valeur: solde ? `${solde.total.toFixed(2)} ${solde.devise}` : "indisponible",
      detail: solde
        ? `rechargé ${solde.recharge.toFixed(2)} ${solde.devise} · offert ${solde.offert.toFixed(2)} ${
            solde.devise
          }${solde.disponible ? "" : " · solde épuisé"}`
        : "clé d'API absente lors de la collecte",
    },
  ];

  conteneur.innerHTML = "";
  grille.forEach((carte) => {
    const noeud = document.createElement("div");
    noeud.className = `carte ${carte.classe || ""}`;
    noeud.innerHTML = `<h3>${carte.titre}</h3><div class="valeur">${carte.valeur}</div><div class="detail">${
      carte.detail || ""
    }</div>`;
    conteneur.appendChild(noeud);
  });
}

async function copier(texte, bouton) {
  try {
    await navigator.clipboard.writeText(texte);
    const initial = bouton.textContent;
    bouton.textContent = "Copié ✓";
    setTimeout(() => {
      bouton.textContent = initial;
    }, 1400);
  } catch (erreur) {
    bouton.textContent = "Copie impossible";
  }
}

function sectionTaches(taches, lienRecharge) {
  const conteneur = document.getElementById("taches");
  conteneur.innerHTML = "";

  if (!taches.length) {
    const vide = document.createElement("p");
    vide.className = "vide";
    vide.innerHTML =
      "Aucune demande en attente. En heures pleines, après votre instruction, Goose vous propose de " +
      "différer : la demande apparaît alors ici avec son prompt, l'application concernée et l'heure de bascule." +
      ` Si le solde descend, <a href="${lienRecharge}" target="_blank" rel="noopener">rechargez le compte API</a>.`;
    conteneur.appendChild(vide);
    return;
  }

  taches.forEach((tache) => {
    const cible = new Date(tache.cible);
    const noeud = document.createElement("article");
    noeud.className = "tache";

    const entete = document.createElement("div");
    entete.className = "entete-tache";
    const gauche = document.createElement("div");
    gauche.innerHTML =
      `<span class="etiquette profil" style="border-color:${COULEUR_PLEINE}">${tache.application}</span> ` +
      `<span class="etiquette profil">${tache.profil || "—"}</span>`;
    const bouton = document.createElement("button");
    bouton.className = "bouton";
    bouton.type = "button";
    bouton.textContent = "Copier le prompt";
    bouton.addEventListener("click", () => copier(tache.prompt, bouton));
    entete.append(gauche, bouton);

    const prompt = document.createElement("pre");
    prompt.className = "prompt";
    prompt.textContent = tache.prompt;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML =
      `<span>Réf. <b>${tache.id}</b></span>` +
      `<span>Créée le <b>${fmtDateHeure(tache.cree_le)}</b></span>` +
      `<span>Exécutable à partir de <b>${horodatageFr(cible)}</b> (dans ${fmtDuree(cible - new Date())})</span>` +
      (tache.session_id ? `<span>Session <b>${tache.session_id}</b></span>` : "") +
      `<span><a href="${lienRecharge}" target="_blank" rel="noopener">Recharger le compte API</a></span>`;

    noeud.append(entete, prompt, meta);
    conteneur.appendChild(noeud);
  });
}

function tableauSessions(listeSessions) {
  const corps = document.getElementById("lignes-sessions");
  corps.innerHTML = "";
  listeSessions.forEach((session) => {
    const ligne = document.createElement("tr");
    ligne.innerHTML =
      `<td class="nom">${session.nom}</td>` +
      `<td>${session.application}</td>` +
      `<td><span class="etiquette profil" style="border-left:3px solid ${session.couleur}">${session.profil}</span></td>` +
      `<td class="nombre">${fmtDollar(session.cout_officiel)}</td>` +
      `<td class="nombre">${session.cout_pleine > 0 ? fmtDollar(session.cout_pleine) : "—"}</td>` +
      `<td class="nombre">${fmtEntier(session.requetes)}</td>` +
      `<td class="nombre">${fmtTokens(session.tokens)}</td>` +
      `<td>${fmtDateHeure(session.fin)}</td>`;
    corps.appendChild(ligne);
  });
}

/* ---------------------------------------------------------------------- init */

function rendreTout() {
  cartes(donnees.totaux, donnees.solde);
  graphiqueJours(donnees.jours);
  graphiqueDonut(donnees.profils);
  graphiqueApplications(donnees.applications);
  carteThermique(donnees.thermique);
  sectionTaches(donnees.en_attente || [], donnees.lien_recharge);
  tableauSessions(donnees.sessions);
  document.getElementById("lien-recharge").href = donnees.lien_recharge;
  document.getElementById("pied-regle").textContent =
    `Heures pleines : ${donnees.regle_horaires.pleines} — ${donnees.regle_horaires.source}`;
  document.getElementById("pied-source").textContent =
    `Grille tarifaire relevée le ${donnees.grille_tarifaire.releve_le} (${donnees.grille_tarifaire.unite}, ` +
    `${donnees.grille_tarifaire.devise}) · données collectées le ${fmtDateHeure(donnees.genere_le)} · ` +
    `source : ${donnees.source_donnees}`;
}

async function initialiser() {
  try {
    const reponse = await fetch("data/suivi.json", { cache: "no-store" });
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    donnees = await reponse.json();
  } catch (erreur) {
    const bandeau = document.getElementById("bandeau");
    bandeau.className = "bandeau erreur";
    bandeau.innerHTML =
      `Données indisponibles (${erreur.message}). Lancez <code>python3 outils/collecter.py</code> ` +
      "à la racine du projet, puis rechargez la page.";
    return;
  }

  joursFeries = new Set(donnees.regle_horaires.jours_feries_chinois || []);
  rendreHorloge();
  rendreTout();
  setInterval(rendreHorloge, 1000);
  setInterval(rendreTout, 60000);
}

document.addEventListener("DOMContentLoaded", initialiser);
