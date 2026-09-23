/* Tableau de bord « Suivi DeepSeek » — application mobile, aucune dépendance externe.
 *
 * Organisation : cinq vues (Synthèse, Coûts, Horaires, Répartition, Demandes)
 * navigables par la barre d'onglets du bas. Les graphiques sont dessinés en SVG
 * à la largeur réelle de l'écran et sont interactifs : glissement pour parcourir,
 * pincement (ou boutons + / −) pour zoomer, double-tap pour tout réafficher,
 * toucher un élément pour en afficher le détail sous le graphique.
 */
"use strict";

/* --------------------------------------------------------------- constantes */

const FENETRES_PLEINES = [
  [1, 4],
  [6, 10],
]; // lundi-vendredi, heures UTC
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const JOURS_COURTS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
const COULEUR_PLEINE = "#f59e0b";
const COULEUR_CREUSE = "#22c55e";
const COULEUR_TOTAL = "#38bdf8";
const NS = "http://www.w3.org/2000/svg";
const ONGLETS = ["synthese", "couts", "horaires", "repartition", "demandes"];
const SESSIONS_AFFICHEES = 12;

let donnees = null;
let joursFeries = new Set();
let copieHorsLigne = false;
let modeCouts = "barres";
let applicationOuverte = null;
let sessionsToutes = false;
let zoomJours = null;
let zoomThermique = null;
let minuteurHorloge = null;
let minuteurRafraichissement = null;

/* ------------------------------------------------------------------ formats */

const dollar = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const dollarCompact = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const entier = new Intl.NumberFormat("fr-FR");
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

const fmtDollar = (v) => `${dollarCompact.format(v || 0)} $`;
const fmtDollarPrecis = (v) => `${dollar.format(v || 0)} $`;
const fmtTokens = (v) => compact.format(v || 0);
const fmtEntier = (v) => entier.format(v || 0);
const fmtPourcent = (v, decimales = 1) => `${((v || 0) * 100).toFixed(decimales)} %`;

function fmtDateHeure(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
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

const somme = (liste, cle) => (liste || []).reduce((acc, item) => acc + (item[cle] || 0), 0);

/* ----------------------------------------------------- heures pleines/creuses */

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
  const bandeau = document.getElementById("bandeau");
  const panneau = document.getElementById("etat-horaires");
  const maintenant = new Date();
  const pleine = estHeurePleine(maintenant);
  const { moment, devientPleine } = prochaineBascule(maintenant);
  const restant = moment - maintenant;

  if (pastille) {
    pastille.className = `pastille ${pleine ? "pleine" : "creuse"}`;
    pastille.innerHTML = pleine
      ? `⏰ Heures pleines <small>· creuses dans ${fmtDuree(restant)}</small>`
      : `🌙 Heures creuses <small>· pleines dans ${fmtDuree(restant)}</small>`;
  }

  if (bandeau && donnees) {
    bandeau.classList.remove("erreur");
    if (pleine) {
      bandeau.className = "bandeau alerte";
      bandeau.innerHTML =
        `<strong>⏰ Heures pleines</strong> — DeepSeek facture le tarif normal jusqu'à ` +
        `<strong>${horodatageFr(moment)}</strong> (${fmtDuree(restant)}). Pour économiser 50 %, dites simplement ` +
        `<strong>« diffère »</strong> à Goose après votre demande : elle sera enregistrée dans l'onglet ` +
        `<strong>Demandes</strong> et rejouable en heures creuses.`;
    } else {
      bandeau.className = "bandeau creuse";
      bandeau.innerHTML =
        `<strong>🌙 Heures creuses</strong> — remise de 50 % sur tous les tokens jusqu'à ` +
        `<strong>${horodatageFr(moment)}</strong> (dans ${fmtDuree(restant)}). C'est le bon moment pour lancer les ` +
        `demandes différées.`;
    }
  }

  if (panneau && donnees) {
    panneau.className = `panneau etat-horaires ${pleine ? "pleine" : "creuse"}`;
    panneau.innerHTML =
      `<div class="etat-grand">${pleine ? "⏰ Heures pleines — tarif normal" : "🌙 Heures creuses — remise de 50 %"}</div>` +
      `<div class="compte">${fmtDuree(restant)}</div>` +
      `<p>avant le passage en heures ${devientPleine ? "pleines" : "creuses"} (${horodatageFr(moment)}).</p>` +
      `<p>Règle DeepSeek : ${donnees.regle_horaires.pleines}. Les nuits, week-ends et jours fériés chinois sont ` +
      `facturés en heures creuses.</p>`;
  }
}

/* ------------------------------------------------------------- outillage SVG */

function svgElement(attrs = {}) {
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

function infobulle(parent, texte) {
  const titre = balise("title");
  titre.textContent = texte;
  parent.appendChild(titre);
  return parent;
}

function texteSvg(x, y, contenu, options = {}) {
  return balise(
    "text",
    {
      x,
      y,
      fill: options.fill || "#93a3bd",
      "font-size": options.taille || 11,
      "text-anchor": options.ancre || "middle",
      "font-weight": options.gras || 400,
    },
    contenu
  );
}

function largeurUtile(conteneur, defaut = 340) {
  return Math.max(260, conteneur.clientWidth || defaut);
}

let compteurClip = 0;

/** Zone de découpe : garde les tracés à l'intérieur de la zone de tracé. */
function zoneDecoupee(racine, x, y, largeur, hauteur) {
  compteurClip += 1;
  const identifiant = `decoupe-${compteurClip}`;
  const defs = balise("defs");
  const decoupe = balise("clipPath", { id: identifiant });
  decoupe.appendChild(balise("rect", { x, y, width: largeur, height: hauteur }));
  defs.appendChild(decoupe);
  racine.appendChild(defs);
  return { identifiant, groupe: () => balise("g", { "clip-path": `url(#${identifiant})` }) };
}

/** Échelle « ronde » : 1 · 2 · 2,5 · 5 · 10 × 10ⁿ. */
function echelleJolie(valeur) {
  if (!(valeur > 0)) return 0.01;
  const exposant = Math.floor(Math.log10(valeur));
  const base = Math.pow(10, exposant);
  const normalise = valeur / base;
  const cran = normalise <= 1 ? 1 : normalise <= 2 ? 2 : normalise <= 2.5 ? 2.5 : normalise <= 5 ? 5 : 10;
  return cran * base;
}

/** Panneau de détail affiché sous un graphique. */
function afficherDetail(id, html, classe = "") {
  const noeud = document.getElementById(id);
  if (!noeud) return;
  noeud.className = `detail-graphique ${classe}`;
  noeud.innerHTML = html;
}

/* ------------------------------------------------------ moteur de zoom (X) */

/**
 * Zoom horizontal partagé par les graphiques.
 *  - un doigt / souris : glissement horizontal = défilement ;
 *  - deux doigts : pincement = zoom autour du milieu ;
 *  - molette, boutons + / − : zoom ; double-tap / bouton ⤢ : tout afficher ;
 *  - tap simple : `onTap` (sélection d'un élément du graphique).
 * La molette et le glissement vertical restent rendus au navigateur (touch-action: pan-y).
 */
function creerZoomX(options) {
  let total = Math.max(1, options.total || 1);
  const minimum = Math.max(0.5, Math.min(options.minimum || 1, total));
  const changer = options.changer || function () {};
  const etat = { debut: 0, taille: total };

  if (options.intervalle && options.intervalle.taille) {
    etat.taille = Math.min(total, Math.max(minimum, options.intervalle.taille));
    etat.debut = options.intervalle.debut || 0;
  }

  function borner() {
    const mini = Math.min(minimum, total);
    etat.taille = Math.min(total, Math.max(mini, etat.taille));
    etat.debut = Math.min(Math.max(0, total - etat.taille), Math.max(0, etat.debut));
  }

  function notifier() {
    borner();
    changer({ debut: etat.debut, taille: etat.taille, total });
  }

  function zoomer(facteur, ancre) {
    const centre = ancre === undefined || ancre === null ? etat.debut + etat.taille / 2 : ancre;
    const fraction = etat.taille > 0 ? (centre - etat.debut) / etat.taille : 0.5;
    const taille = etat.taille / facteur;
    etat.debut = centre - Math.min(Math.max(fraction, 0), 1) * taille;
    etat.taille = taille;
    notifier();
  }

  function reinitialiser() {
    etat.debut = 0;
    etat.taille = total;
    notifier();
  }

  function majTotal(nouveau) {
    const valeur = Math.max(1, nouveau);
    if (valeur === total) return;
    const plein = etat.taille >= total - 1e-9;
    total = valeur;
    if (plein) {
      etat.debut = 0;
      etat.taille = total;
    }
    notifier();
  }

  function largeurPixels(element) {
    const largeur = options.largeurTrace ? options.largeurTrace() : element.clientWidth;
    return Math.max(80, largeur || 80);
  }

  function ancreDepuisPixels(element, clientX) {
    const rect = element.getBoundingClientRect();
    const bord = options.margeGauche ? options.margeGauche() : 0;
    const fraction = (clientX - rect.left - bord) / largeurPixels(element);
    return etat.debut + Math.min(Math.max(fraction, 0), 1) * etat.taille;
  }

  function attacher(element) {
    if (!element) return;
    const pointeurs = new Map();
    let glissement = null;
    let pincement = null;
    let depart = null;
    let dernierTap = 0;

    element.addEventListener("pointerdown", (evenement) => {
      if (evenement.pointerType === "mouse" && evenement.button !== 0) return;
      pointeurs.set(evenement.pointerId, { x: evenement.clientX, y: evenement.clientY });
      try {
        element.setPointerCapture(evenement.pointerId);
      } catch (erreur) {
        /* capture indisponible : le glissement reste utilisable */
      }
      if (pointeurs.size === 1) {
        glissement = { x: evenement.clientX, debut: etat.debut };
        depart = { cible: evenement.target, x: evenement.clientX, y: evenement.clientY, temps: Date.now() };
        pincement = null;
      } else if (pointeurs.size === 2) {
        const [a, b] = [...pointeurs.values()];
        const ancre = ancreDepuisPixels(element, (a.x + b.x) / 2);
        pincement = {
          distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          taille: etat.taille,
          ancre,
          fraction: etat.taille > 0 ? Math.min(Math.max((ancre - etat.debut) / etat.taille, 0), 1) : 0.5,
        };
        glissement = null;
      }
    });

    element.addEventListener("pointermove", (evenement) => {
      if (!pointeurs.has(evenement.pointerId)) return;
      pointeurs.set(evenement.pointerId, { x: evenement.clientX, y: evenement.clientY });
      if (pointeurs.size >= 2 && pincement) {
        const [a, b] = [...pointeurs.values()];
        const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const taille = pincement.taille / (distance / pincement.distance);
        etat.taille = Math.min(total, Math.max(Math.min(minimum, total), taille));
        etat.debut = pincement.ancre - pincement.fraction * etat.taille;
        notifier();
      } else if (pointeurs.size === 1 && glissement) {
        const parPixel = etat.taille / largeurPixels(element);
        etat.debut = glissement.debut - (evenement.clientX - glissement.x) * parPixel;
        notifier();
      }
    });

    function relacher(evenement) {
      if (!pointeurs.has(evenement.pointerId)) return;
      const informations = depart;
      const tapPossible = evenement.type === "pointerup";
      pointeurs.delete(evenement.pointerId);
      if (pointeurs.size < 2) pincement = null;
      if (pointeurs.size === 0) {
        glissement = null;
        depart = null;
        if (!informations || !tapPossible) return;
        const dx = Math.abs(evenement.clientX - informations.x);
        const dy = Math.abs(evenement.clientY - informations.y);
        if (dx > 10 || dy > 10 || Date.now() - informations.temps > 400) return;
        const maintenant = Date.now();
        if (maintenant - dernierTap < 320) {
          dernierTap = 0;
          reinitialiser();
          return;
        }
        dernierTap = maintenant;
        if (options.onTap) options.onTap(informations.cible);
      }
    }

    element.addEventListener("pointerup", relacher);
    element.addEventListener("pointercancel", relacher);

    element.addEventListener(
      "wheel",
      (evenement) => {
        evenement.preventDefault();
        zoomer(evenement.deltaY < 0 ? 1.15 : 1 / 1.15, ancreDepuisPixels(element, evenement.clientX));
      },
      { passive: false }
    );

    element.addEventListener("dblclick", (evenement) => {
      evenement.preventDefault();
      reinitialiser();
    });
  }

  function brancherBoutons(racine) {
    if (!racine) return;
    racine.querySelectorAll("button[data-zoom-action]").forEach((bouton) => {
      bouton.addEventListener("click", () => {
        const action = bouton.getAttribute("data-zoom-action");
        if (action === "plus") zoomer(1.5);
        else if (action === "moins") zoomer(1 / 1.5);
        else reinitialiser();
      });
    });
  }

  return {
    etat: () => ({ debut: etat.debut, taille: etat.taille, total }),
    zoomer,
    reinitialiser,
    majTotal,
    attacher,
    brancherBoutons,
    rafraichir: notifier,
  };
}

/* --------------------------------------------------- graphique : coût/jour */

function cumulsJours() {
  let total = 0;
  let pleine = 0;
  return (donnees.jours || []).map((jour) => {
    total += jour.cout_officiel;
    pleine += jour.cout_pleine;
    return { total, pleine };
  });
}

function bornesJours(etat) {
  const jours = donnees.jours || [];
  const debut = Math.max(0, Math.floor(etat.debut));
  const fin = Math.min(jours.length - 1, Math.max(debut, Math.ceil(etat.debut + etat.taille) - 1));
  return { debut, fin, tranche: jours.slice(debut, fin + 1) };
}

function dessinerJours(etat) {
  const conteneur = document.getElementById("graphique-jours");
  if (!conteneur || !donnees) return;
  const jours = donnees.jours || [];
  conteneur.innerHTML = "";
  conteneur.classList.toggle("vide", !jours.length);
  if (!jours.length) {
    conteneur.innerHTML = '<p class="vide">Aucune donnée collectée.</p>';
    return;
  }

  const largeur = largeurUtile(conteneur);
  const hauteur = 244;
  const marges = { haut: 16, bas: 30, gauche: 48, droite: 10 };
  const utileLargeur = largeur - marges.gauche - marges.droite;
  const utileHauteur = hauteur - marges.haut - marges.bas;
  const { debut, fin } = bornesJours(etat);
  const cumuls = cumulsJours();

  const racine = svgElement({
    viewBox: `0 0 ${largeur} ${hauteur}`,
    height: hauteur,
    role: "img",
    "aria-label": "Coût par jour selon les tarifs DeepSeek",
  });
  const positionX = (index) => marges.gauche + ((index + 0.5 - etat.debut) / etat.taille) * utileLargeur;

  let haut = 0;
  let bas = 0;
  if (modeCouts === "cumul") {
    haut = cumuls[fin] ? cumuls[fin].total : 0;
    bas = debut > 0 && cumuls[debut - 1] ? cumuls[debut - 1].total : 0;
  } else {
    haut = echelleJolie(Math.max(...jours.slice(debut, fin + 1).map((j) => j.cout_officiel), 0.0001) * 1.08);
    bas = 0;
  }
  const amplitude = Math.max(haut - bas, 1e-6);
  const positionY = (valeur) => marges.haut + utileHauteur * (1 - (valeur - bas) / amplitude);

  // Grille + graduations
  for (let i = 0; i <= 4; i += 1) {
    const y = marges.haut + (utileHauteur * i) / 4;
    racine.appendChild(
      balise("line", {
        x1: marges.gauche,
        x2: largeur - marges.droite,
        y1: y,
        y2: y,
        stroke: "#24324a",
        "stroke-dasharray": i === 4 ? "0" : "3 5",
      })
    );
    racine.appendChild(
      texteSvg(marges.gauche - 8, y + 4, fmtDollar(bas + (amplitude * (4 - i)) / 4), { ancre: "end" })
    );
  }

  const pas = utileLargeur / etat.taille;
  const tousLes = Math.max(1, Math.ceil(34 / pas));
  const margeDecoupe = modeCouts === "cumul" ? 8 : 0;
  const serie = zoneDecoupee(
    racine,
    marges.gauche - margeDecoupe,
    0,
    utileLargeur + margeDecoupe * 2,
    hauteur
  ).groupe();
  const etiquetteDate = (index, cx) => {
    if (index % tousLes !== 0 && index !== fin) return;
    serie.appendChild(texteSvg(cx, hauteur - 11, fmtDateJour(jours[index].date)));
  };

  if (modeCouts === "barres") {
    const largeurBarre = Math.max(3, Math.min(54, pas * 0.62));
    for (let index = debut; index <= fin; index += 1) {
      const jour = jours[index];
      const cx = positionX(index);
      // Zone tactile pleine hauteur, pour sélectionner même un jour à 0 $.
      racine.appendChild(
        balise("rect", {
          x: cx - largeurBarre / 2 - 2,
          y: marges.haut,
          width: largeurBarre + 4,
          height: utileHauteur,
          fill: "#000",
          opacity: 0,
          "data-jour": jour.date,
        })
      );
      let cumul = 0;
      for (const [cle, couleur, libelle] of [
        ["cout_creuse", COULEUR_CREUSE, "heures creuses"],
        ["cout_pleine", COULEUR_PLEINE, "heures pleines"],
      ]) {
        const valeur = jour[cle] || 0;
        if (valeur <= 0) continue;
        const h = Math.max((valeur / amplitude) * utileHauteur, 2);
        const rect = balise("rect", {
          x: cx - largeurBarre / 2,
          y: positionY(0) - cumul - h,
          width: largeurBarre,
          height: h,
          rx: 3,
          fill: couleur,
          opacity: 0.95,
          "data-jour": jour.date,
        });
        infobulle(rect, `${jour.date} — ${libelle} : ${fmtDollarPrecis(valeur)}`);
        serie.appendChild(rect);
        cumul += h;
      }
      etiquetteDate(index, cx);
    }
    document.getElementById("legende-jours").innerHTML =
      "<span><i style=\"background: " + COULEUR_PLEINE + "\"></i>Heures pleines (tarif normal)</span>" +
      "<span><i style=\"background: " + COULEUR_CREUSE + "\"></i>Heures creuses (−50 %)</span>";
  } else {
    const points = [];
    for (let index = debut; index <= fin; index += 1) {
      points.push({
        index,
        x: positionX(index),
        total: cumuls[index].total,
        pleine: cumuls[index].pleine,
        date: jours[index].date,
      });
    }
    const chemin = (cle) => "M " + points.map((p) => `${p.x} ${positionY(p[cle])}`).join(" L ");
    serie.appendChild(
      balise("path", {
        d: `${chemin("total")} L ${points[points.length - 1].x} ${positionY(bas)} L ${points[0].x} ${positionY(bas)} Z`,
        fill: COULEUR_TOTAL,
        opacity: 0.12,
      })
    );
    serie.appendChild(
      balise("path", {
        d: chemin("total"),
        fill: "none",
        stroke: COULEUR_TOTAL,
        "stroke-width": 2.6,
        "stroke-linejoin": "round",
      })
    );
    serie.appendChild(
      balise("path", {
        d: chemin("pleine"),
        fill: "none",
        stroke: COULEUR_PLEINE,
        "stroke-width": 2,
        "stroke-dasharray": "5 4",
      })
    );
    points.forEach((point) => {
      const cercle = balise("circle", {
        cx: point.x,
        cy: positionY(point.total),
        r: 4,
        fill: "#0b1220",
        stroke: COULEUR_TOTAL,
        "stroke-width": 2,
        "data-jour": point.date,
      });
      infobulle(cercle, `${point.date} — cumul : ${fmtDollarPrecis(point.total)}`);
      serie.appendChild(cercle);
      etiquetteDate(point.index, point.x);
    });
    document.getElementById("legende-jours").innerHTML =
      `<span><i style="background: ${COULEUR_TOTAL}"></i>Cumul depuis le début</span>` +
      `<span><i style="background: ${COULEUR_PLEINE}"></i>dont heures pleines</span>`;
  }

  racine.appendChild(serie);
  conteneur.appendChild(racine);
}

function resumeJours(etat) {
  const { tranche } = bornesJours(etat);
  if (!tranche.length) return "<span>Aucune donnée collectée.</span>";
  const cout = somme(tranche, "cout_officiel");
  const pleine = somme(tranche, "cout_pleine");
  const requetes = somme(tranche, "requetes");
  const libelle = tranche.length > 1 ? `${tranche.length} jours affichés` : "1 jour affiché";
  return (
    `<span><b>${libelle}</b> · ${fmtDateJour(tranche[0].date)} → ${fmtDateJour(tranche[tranche.length - 1].date)}` +
    ` · <b>${fmtDollar(cout)}</b> dont ${fmtDollar(pleine)} en heures pleines · ${fmtEntier(requetes)} requêtes</span>`
  );
}

function detailJour(iso) {
  const jour = (donnees.jours || []).find((j) => j.date === iso);
  if (!jour) return;
  const date = new Date(`${iso}T12:00:00Z`);
  afficherDetail(
    "detail-jours",
    `<span><b>${JOURS[date.getUTCDay()]} ${fmtDateJour(iso)}</b> — total <b>${fmtDollarPrecis(
      jour.cout_officiel
    )}</b> · pleines ${fmtDollarPrecis(jour.cout_pleine)} · creuses ${fmtDollarPrecis(
      jour.cout_creuse
    )} · ${fmtEntier(jour.requetes)} requêtes · ${fmtTokens(jour.tokens)} tokens</span>`
  );
}

function majIndicationJours(etat) {
  const indication = document.getElementById("indication-jours");
  if (!indication) return;
  const arrondi = Math.round(etat.taille * 10) / 10;
  indication.textContent =
    etat.taille >= (donnees.jours || []).length - 1e-9 ? "Tout est affiché" : `Fenêtre : ${arrondi} j`;
}

/* ----------------------------------------------------- graphique : créneaux */

function dessinerThermique(etat) {
  const conteneur = document.getElementById("carte-thermique");
  if (!conteneur || !donnees) return;
  const cellules = donnees.thermique || [];
  conteneur.innerHTML = "";
  conteneur.classList.toggle("vide", !cellules.length);
  if (!cellules.length) {
    conteneur.innerHTML = '<p class="vide">Aucune donnée collectée.</p>';
    return;
  }

  const largeur = largeurUtile(conteneur);
  const marges = { gauche: 32, droite: 6, haut: 18, bas: 6 };
  const largeurCellule = Math.min(46, (largeur - marges.gauche - marges.droite) / etat.taille);
  const hauteurCellule = 26;
  const hauteur = marges.haut + 7 * hauteurCellule + marges.bas;
  const ordreJours = [1, 2, 3, 4, 5, 6, 0];
  const maximum = Math.max(...cellules.map((c) => c.cout), 0.0001);
  const racine = svgElement({
    viewBox: `0 0 ${largeur} ${hauteur}`,
    height: hauteur,
    role: "img",
    "aria-label": "Carte horaire des coûts",
  });

  const premiereHeure = Math.max(0, Math.floor(etat.debut));
  const derniereHeure = Math.min(23, Math.ceil(etat.debut + etat.taille) - 1);
  const pasHeures = Math.max(1, Math.ceil(26 / largeurCellule));
  // Les cases qui débordent de la fenêtre visible sont coupées : elles ne
  // recouvrent ni l'axe des jours ni les libellés d'heures.
  const serie = zoneDecoupee(racine, marges.gauche, 0, etat.taille * largeurCellule, hauteur).groupe();

  for (let heure = premiereHeure; heure <= derniereHeure; heure += 1) {
    if (heure % pasHeures !== 0 && heure !== premiereHeure) continue;
    racine.appendChild(
      texteSvg(marges.gauche + (heure - etat.debut) * largeurCellule + largeurCellule / 2, 12, `${String(heure).padStart(2, "0")}h`, {
        taille: 10,
      })
    );
  }

  ordreJours.forEach((jour, ligne) => {
    const y = marges.haut + ligne * hauteurCellule;
    racine.appendChild(
      texteSvg(marges.gauche - 7, y + 17, JOURS_COURTS[jour], { taille: 10.5, ancre: "end" })
    );
    for (let heure = premiereHeure; heure <= derniereHeure; heure += 1) {
      const cellule = cellules.find((c) => c.jour === jour && c.heure_utc === heure);
      const cout = cellule ? cellule.cout : 0;
      const intensite = Math.min(1, Math.sqrt(cout / maximum));
      const pleine = cellule
        ? cellule.pleine
        : FENETRES_PLEINES.some(([a, b]) => heure >= a && heure < b) && jour !== 0 && jour !== 6;
      const rect = balise("rect", {
        class: "cellule",
        x: marges.gauche + (heure - etat.debut) * largeurCellule,
        y,
        width: Math.max(2, largeurCellule - 3),
        height: hauteurCellule - 3,
        rx: 4,
        fill: intensite === 0 ? "#16223a" : `rgba(56, 189, 248, ${(0.12 + intensite * 0.85).toFixed(2)})`,
        "data-jour": jour,
        "data-heure": heure,
      });
      if (pleine && jour !== 0 && jour !== 6) {
        rect.setAttribute("stroke", COULEUR_PLEINE);
        rect.setAttribute("stroke-width", 1.4);
      }
      infobulle(
        rect,
        `${JOURS[jour]} ${String(heure).padStart(2, "0")} h UTC — ${
          pleine ? "heures pleines" : "heures creuses"
        } : ${fmtDollarPrecis(cout)}${cellule ? ` · ${fmtEntier(cellule.requetes)} requêtes` : ""}`
      );
      serie.appendChild(rect);
    }
  });

  racine.appendChild(serie);
  conteneur.appendChild(racine);
}

function detailCreneau(jour, heure) {
  const cellule = (donnees.thermique || []).find((c) => c.jour === jour && c.heure_utc === heure);
  const pleine = cellule
    ? cellule.pleine
    : FENETRES_PLEINES.some(([a, b]) => heure >= a && heure < b) && jour !== 0 && jour !== 6;
  afficherDetail(
    "detail-thermique",
    `<span><b>${JOURS[jour]} ${String(heure).padStart(2, "0")} h UTC</b> — ${
      pleine ? "heures pleines (tarif normal)" : "heures creuses (−50 %)"
    } · <b>${fmtDollarPrecis(cellule ? cellule.cout : 0)}</b> cumulés${
      cellule ? ` · ${fmtEntier(cellule.requetes)} requêtes · ${fmtTokens(cellule.tokens)} tokens` : ""
    }</span>`
  );
}

function listeCreneaux() {
  const conteneur = document.getElementById("creneaux");
  if (!conteneur || !donnees) return;
  const cellules = (donnees.thermique || []).filter((c) => c.cout > 0).sort((a, b) => b.cout - a.cout).slice(0, 6);
  conteneur.innerHTML = "";
  if (!cellules.length) {
    conteneur.innerHTML = '<p class="vide">Aucune donnée collectée.</p>';
    return;
  }
  const maximum = cellules[0].cout;
  cellules.forEach((cellule) => {
    const ligne = document.createElement("button");
    ligne.type = "button";
    ligne.className = "creneau";
    ligne.innerHTML =
      `<span class="nom">${JOURS[cellule.jour]} ${String(cellule.heure_utc).padStart(2, "0")} h UTC</span>` +
      `<span class="valeur">${fmtDollar(cellule.cout)}</span>` +
      `<span class="jauge"><i style="width:${((cellule.cout / maximum) * 100).toFixed(1)}%;background:${
        cellule.pleine ? COULEUR_PLEINE : COULEUR_CREUSE
      }"></i></span>` +
      `<span class="meta">${cellule.pleine ? "heures pleines" : "heures creuses"} · ${fmtEntier(
        cellule.requetes
      )} requêtes · ${fmtTokens(cellule.tokens)} tokens</span>`;
    ligne.addEventListener("click", () => detailCreneau(cellule.jour, cellule.heure_utc));
    conteneur.appendChild(ligne);
  });
}

/* -------------------------------------------------------- donut des profils */

function dessinerProfils(profils) {
  const conteneur = document.getElementById("graphique-profils");
  const legende = document.getElementById("legende-profils");
  if (!conteneur || !legende) return;
  conteneur.innerHTML = "";
  legende.innerHTML = "";

  const total = profils.reduce((acc, p) => acc + p.cout_officiel, 0);
  const taille = Math.min(210, Math.max(170, conteneur.clientWidth || 200));
  const rayon = taille * 0.36;
  const epaisseur = taille * 0.11;
  const circonference = 2 * Math.PI * rayon;
  const racine = svgElement({ viewBox: `0 0 ${taille} ${taille}`, height: taille, role: "img" });

  racine.appendChild(
    balise("circle", {
      cx: taille / 2,
      cy: taille / 2,
      r: rayon,
      fill: "none",
      stroke: "#1c2740",
      "stroke-width": epaisseur,
    })
  );

  let decalage = 0;
  profils.forEach((profil) => {
    const part = total ? profil.cout_officiel / total : 0;
    const arc = balise("circle", {
      class: "cellule",
      cx: taille / 2,
      cy: taille / 2,
      r: rayon,
      fill: "none",
      stroke: profil.couleur,
      "stroke-width": epaisseur,
      "stroke-dasharray": `${(part * circonference).toFixed(2)} ${circonference.toFixed(2)}`,
      "stroke-dashoffset": (-decalage * circonference).toFixed(2),
      transform: `rotate(-90 ${taille / 2} ${taille / 2})`,
    });
    infobulle(arc, `${profil.nom} : ${fmtDollarPrecis(profil.cout_officiel)} (${fmtPourcent(part)})`);
    racine.appendChild(arc);
    decalage += part;
  });

  racine.appendChild(
    texteSvg(taille / 2, taille / 2 - taille * 0.02, "Total", { taille: taille * 0.06 })
  );
  racine.appendChild(
    balise(
      "text",
      {
        x: taille / 2,
        y: taille / 2 + taille * 0.09,
        fill: "#e6ecf5",
        "font-size": Math.max(16, taille * 0.115),
        "font-weight": 700,
        "text-anchor": "middle",
      },
      fmtDollar(total)
    )
  );
  racine.addEventListener("click", (evenement) => {
    const arc = evenement.target.closest("[stroke]");
    const nom = arc && arc.getAttribute("stroke");
    const profil = profils.find((p) => p.couleur === nom);
    if (profil) detailProfil(profil);
  });
  conteneur.appendChild(racine);

  profils.forEach((profil) => {
    const part = total ? profil.cout_officiel / total : 0;
    const item = document.createElement("span");
    item.innerHTML =
      `<i style="background:${profil.couleur}"></i>${profil.nom} — ${(part * 100).toFixed(1)} % · ` +
      `${fmtDollar(profil.cout_officiel)} · ${fmtEntier(profil.sessions)} sessions`;
    item.addEventListener("click", () => detailProfil(profil));
    legende.appendChild(item);
  });
}

function detailProfil(profil) {
  afficherDetail(
    "detail-profils",
    `<span><b>${profil.nom}</b> — ${fmtDollarPrecis(profil.cout_officiel)} dont ${fmtDollarPrecis(
      profil.cout_pleine
    )} en heures pleines · ${fmtEntier(profil.sessions)} sessions · ${fmtEntier(
      profil.requetes
    )} requêtes · ${fmtTokens(profil.tokens)} tokens</span>`
  );
}

/* ---------------------------------------------------- barres applications */

function listeApplications(applications) {
  const conteneur = document.getElementById("graphique-applications");
  if (!conteneur) return;
  conteneur.innerHTML = "";
  if (!applications.length) {
    conteneur.innerHTML = '<p class="vide">Aucune donnée collectée.</p>';
    return;
  }
  const maximum = Math.max(...applications.map((a) => a.cout_officiel), 0.0001);

  applications.forEach((application) => {
    const ouverte = applicationOuverte === application.nom;
    const partPleines = application.cout_officiel ? application.cout_pleine / application.cout_officiel : 0;
    const largeurRelative = (application.cout_officiel / maximum) * 100;
    const bloc = document.createElement("button");
    bloc.type = "button";
    bloc.className = "application";
    bloc.setAttribute("aria-expanded", ouverte ? "true" : "false");
    bloc.innerHTML =
      `<span class="ligne"><span class="nom">${application.nom}</span><span class="montant">${fmtDollar(
        application.cout_officiel
      )}${ouverte ? " ▲" : " ▾"}</span></span>` +
      `<span class="piste" style="width:${largeurRelative.toFixed(1)}%">` +
      `<i style="width:${((1 - partPleines) * 100).toFixed(1)}%;background:${COULEUR_CREUSE}"></i>` +
      `<i style="width:${(partPleines * 100).toFixed(1)}%;background:${COULEUR_PLEINE}"></i></span>` +
      `<span class="meta">${application.profil} · ${fmtEntier(application.requetes)} requêtes · ${fmtEntier(
        application.sessions
      )} sessions</span>` +
      (ouverte
        ? `<span class="details">` +
          `<span>Heures pleines : <b>${fmtDollarPrecis(application.cout_pleine)}</b> · heures creuses : <b>${fmtDollarPrecis(
            application.cout_creuse
          )}</b></span>` +
          `<span>Tokens : <b>${fmtTokens(application.tokens)}</b> · dernière activité : <b>${fmtDateHeure(
            application.derniere_activite
          )}</b></span>` +
          `</span>`
        : "");
    bloc.addEventListener("click", () => {
      applicationOuverte = ouverte ? null : application.nom;
      listeApplications(donnees.applications);
    });
    conteneur.appendChild(bloc);
  });
}

/* ---------------------------------------------------------- sessions (cartes) */

function listeSessions(sessions) {
  const conteneur = document.getElementById("lignes-sessions");
  const bouton = document.getElementById("bouton-plus-sessions");
  const compte = document.getElementById("compte-sessions");
  if (!conteneur) return;

  const triees = [...sessions].sort((a, b) => new Date(b.fin || 0) - new Date(a.fin || 0));
  const affichees = sessionsToutes ? triees : triees.slice(0, SESSIONS_AFFICHEES);
  conteneur.innerHTML = "";
  if (compte) compte.textContent = `${fmtEntier(triees.length)} sessions collectées`;
  if (bouton) bouton.hidden = triees.length <= SESSIONS_AFFICHEES;

  affichees.forEach((session) => {
    const bloc = document.createElement("article");
    bloc.className = "session";
    bloc.style.borderLeftColor = session.couleur;
    bloc.innerHTML =
      `<span class="ligne"><span class="nom">${session.nom}</span><span class="montant">${fmtDollar(
        session.cout_officiel
      )}</span></span>` +
      `<span class="meta">` +
      `<span class="etiquette">${session.application}</span>` +
      `<span>${session.profil}</span>` +
      `<span>${fmtEntier(session.requetes)} req.</span>` +
      `<span>${fmtTokens(session.tokens)} tokens</span>` +
      (session.cout_pleine > 0 ? `<span>dont ${fmtDollar(session.cout_pleine)} pleines</span>` : "") +
      `</span>` +
      `<span class="meta"><span>Fin : ${fmtDateHeure(session.fin)}</span><span>Modèle : ${session.modele || "—"}</span></span>`;
    conteneur.appendChild(bloc);
  });

  if (bouton && !bouton.dataset.pret) {
    bouton.dataset.pret = "1";
    bouton.addEventListener("click", () => {
      sessionsToutes = true;
      listeSessions(donnees.sessions);
    });
  }
}

/* ------------------------------------------------------------------ repères */

function remplirReperes(totaux, jours) {
  const conteneur = document.getElementById("reperes-couts");
  if (!conteneur) return;
  const nombreJours = Math.max(1, (jours || []).length);
  const moyenne = totaux.cout_officiel / nombreJours;
  const lignes = [
    ["Coût total (grille officielle)", fmtDollar(totaux.cout_officiel)],
    ["Coût moyen par jour collecté", fmtDollar(moyenne)],
    ["Projection sur 30 jours", fmtDollar(moyenne * 30)],
    ["Part en heures pleines", fmtPourcent(totaux.part_pleine)],
    ["Économie possible en différant", fmtDollar(totaux.economie_possible)],
    ["Tokens servis par le cache", fmtPourcent(totaux.taux_cache)],
  ];
  conteneur.innerHTML = lignes.map(([libelle, valeur]) => `<div><dt>${libelle}</dt><dd>${valeur}</dd></div>`).join("");
}

/* ------------------------------------------------------------- indicateurs */

function cartes(totaux, solde) {
  const conteneur = document.getElementById("cartes");
  if (!conteneur) return;
  const grille = [
    {
      titre: "Coût total",
      valeur: fmtDollar(totaux.cout_officiel),
      detail: `${fmtEntier(totaux.requetes)} requêtes · estimation goose : ${fmtDollar(totaux.cout_goose)}`,
    },
    {
      titre: "Dont heures pleines",
      valeur: fmtDollar(totaux.cout_officiel_pleine),
      detail: `${fmtPourcent(totaux.part_pleine)} de la dépense`,
      classe: "pleine",
    },
    {
      titre: "Dont heures creuses",
      valeur: fmtDollar(totaux.cout_officiel_creuse),
      detail: "remise de 50 % appliquée",
      classe: "creuse",
    },
    {
      titre: "Économie possible",
      valeur: fmtDollar(totaux.economie_possible),
      detail: "si les heures pleines étaient différées",
    },
    {
      titre: "Tokens",
      valeur: fmtTokens(totaux.tokens_total),
      detail: `${fmtPourcent(totaux.taux_cache)} servis par le cache`,
    },
    {
      titre: "Solde du compte",
      valeur: solde ? `${solde.total.toFixed(2)} ${solde.devise}` : "indisponible",
      detail: solde
        ? `rechargé ${solde.recharge.toFixed(2)} ${solde.devise} · offert ${solde.offert.toFixed(2)} ${
            solde.devise
          }${solde.disponible ? "" : " · solde épuisé"}`
        : "clé d'API absente lors de la collecte",
      classe: "large",
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

function dessinerMiniJours() {
  const conteneur = document.getElementById("mini-jours");
  if (!conteneur) return;
  const jours = (donnees.jours || []).slice(-7);
  conteneur.innerHTML = "";
  if (!jours.length) {
    conteneur.innerHTML = '<p class="vide">Aucune donnée collectée.</p>';
    return;
  }
  const maximum = Math.max(...jours.map((j) => j.cout_officiel), 0.0001);
  jours.forEach((jour) => {
    const hauteur = Math.max(3, Math.round((jour.cout_officiel / maximum) * 84));
    const bloc = document.createElement("div");
    bloc.className = "mini-jour";
    bloc.innerHTML =
      `<div class="mini-piste" style="height:${hauteur}px">` +
      `<div class="mini-seg creuse" style="flex:${Math.max(jour.cout_creuse, 0.0001)}"></div>` +
      `<div class="mini-seg pleine" style="flex:${Math.max(jour.cout_pleine, 0.0001)}"></div>` +
      `</div><span class="mini-etiquette">${fmtDateJour(jour.date)}</span>`;
    bloc.addEventListener("click", () => {
      montrerOnglet("couts");
      detailJour(jour.date);
    });
    conteneur.appendChild(bloc);
  });
}

/* ------------------------------------------------------- demandes différées */

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

function carteTache(tache, lienRecharge, traitee) {
  const noeud = document.createElement("article");
  noeud.className = `tache${traitee ? " traitee" : ""}`;

  const entete = document.createElement("div");
  entete.className = "entete-tache";
  const gauche = document.createElement("div");
  gauche.innerHTML =
    `<span class="etiquette" style="border-color:${traitee ? COULEUR_CREUSE : COULEUR_PLEINE}">${
      tache.application
    }</span> ` + `<span class="etiquette">${tache.profil || "—"}</span>`;
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
  const cible = new Date(tache.cible);
  const statut = traitee
    ? `<span>Statut <b>${tache.statut || "traitée"}</b></span>`
    : `<span>Exécutable à partir de <b>${horodatageFr(cible)}</b> (dans ${fmtDuree(cible - new Date())})</span>`;
  meta.innerHTML =
    `<span>Réf. <b>${tache.id}</b></span>` +
    `<span>Créée le <b>${fmtDateHeure(tache.cree_le)}</b></span>` +
    statut +
    (traitee ? "" : `<span><a href="${lienRecharge}" target="_blank" rel="noopener">Recharger</a></span>`);

  noeud.append(entete, prompt, meta);
  return noeud;
}

function sectionTaches(enAttente, traitees, lienRecharge) {
  const conteneur = document.getElementById("taches");
  const compte = document.getElementById("compte-attente");
  const badge = document.getElementById("badge-demandes");
  if (compte) compte.textContent = enAttente.length ? `${enAttente.length} en attente` : "aucune";
  if (badge) {
    badge.hidden = !enAttente.length;
    badge.textContent = String(enAttente.length);
  }
  if (!conteneur) return;
  conteneur.innerHTML = "";
  if (!enAttente.length) {
    const vide = document.createElement("p");
    vide.className = "vide";
    vide.innerHTML =
      "Aucune demande en attente. En heures pleines, après votre instruction, Goose vous propose de différer : " +
      "la demande apparaît alors ici avec son prompt, l'application concernée et l'heure de bascule.";
    conteneur.appendChild(vide);
  } else {
    enAttente.forEach((tache) => conteneur.appendChild(carteTache(tache, lienRecharge, false)));
  }

  const panneau = document.getElementById("panneau-traitees");
  const conteneurTraitees = document.getElementById("taches-traitees");
  const compteTraitees = document.getElementById("compte-traitees");
  const liste = traitees || [];
  if (panneau) panneau.hidden = !liste.length;
  if (compteTraitees) compteTraitees.textContent = `${liste.length} demande(s)`;
  if (conteneurTraitees) {
    conteneurTraitees.innerHTML = "";
    liste
      .slice()
      .reverse()
      .slice(0, 5)
      .forEach((tache) => conteneurTraitees.appendChild(carteTache(tache, lienRecharge, true)));
  }
}

/* ----------------------------------------------------------------- rendu vues */

function preparerZooms() {
  if (!zoomJours) {
    const total = Math.max(1, (donnees.jours || []).length);
    zoomJours = creerZoomX({
      total,
      minimum: 1,
      changer: (etat) => {
        majIndicationJours(etat);
        dessinerJours(etat);
        afficherDetail("detail-jours", resumeJours(etat));
      },
      largeurTrace: () => {
        const conteneur = document.getElementById("graphique-jours");
        return Math.max(120, (conteneur ? conteneur.clientWidth : 340) - 58);
      },
      margeGauche: () => 48,
      onTap: (cible) => {
        const element = cible && cible.closest ? cible.closest("[data-jour]") : null;
        if (element) detailJour(element.getAttribute("data-jour"));
      },
    });
    zoomJours.attacher(document.getElementById("graphique-jours"));
    zoomJours.brancherBoutons(document.querySelector('[data-zoom="jours"]'));
  }

  if (!zoomThermique) {
    const conteneur = document.getElementById("carte-thermique");
    const largeur = largeurUtile(conteneur || { clientWidth: 340 });
    const tailleInitiale = Math.min(24, Math.max(6, (largeur - 38) / 24));
    zoomThermique = creerZoomX({
      total: 24,
      minimum: 3,
      intervalle: { debut: 0, taille: tailleInitiale },
      changer: (etat) => {
        dessinerThermique(etat);
        afficherDetail(
          "detail-thermique",
          `<span><b>${Math.round(etat.taille)} heures affichées</b> — de ${String(
            Math.max(0, Math.floor(etat.debut))
          ).padStart(2, "0")} h à ${String(Math.min(24, Math.ceil(etat.debut + etat.taille))).padStart(
            2,
            "0"
          )} h UTC · touchez une case pour le détail d'un créneau.</span>`
        );
      },
      largeurTrace: () => {
        const noeud = document.getElementById("carte-thermique");
        return Math.max(120, (noeud ? noeud.clientWidth : 340) - 38);
      },
      margeGauche: () => 32,
      onTap: (cible) => {
        const element = cible && cible.closest ? cible.closest("[data-heure]") : null;
        if (element) {
          detailCreneau(Number(element.getAttribute("data-jour")), Number(element.getAttribute("data-heure")));
        }
      },
    });
    zoomThermique.attacher(document.getElementById("carte-thermique"));
    zoomThermique.brancherBoutons(document.querySelector('[data-zoom="thermique"]'));
  }
}

function rendreTout() {
  if (!donnees) return;
  if (!zoomJours || !zoomThermique) preparerZooms();
  cartes(donnees.totaux, donnees.solde);
  dessinerMiniJours();
  remplirReperes(donnees.totaux, donnees.jours);
  dessinerProfils(donnees.profils);
  afficherDetail("detail-profils", "<span>Touchez un profil, une part du donut ou une légende pour en voir le détail.</span>");
  listeApplications(donnees.applications);
  listeSessions(donnees.sessions);
  listeCreneaux();
  sectionTaches(donnees.en_attente || [], donnees.en_attente_traitees || [], donnees.lien_recharge);

  zoomJours.majTotal(Math.max(1, (donnees.jours || []).length));
  zoomJours.rafraichir();
  zoomThermique.rafraichir();

  document.querySelectorAll("[data-lien-recharge], #lien-recharge").forEach((lien) => {
    lien.href = donnees.lien_recharge;
  });
  const piedRegle = document.getElementById("pied-regle");
  if (piedRegle) {
    piedRegle.textContent = `Heures pleines : ${donnees.regle_horaires.pleines} — ${donnees.regle_horaires.source}`;
  }
  const piedSource = document.getElementById("pied-source");
  if (piedSource) {
    piedSource.textContent =
      `Grille tarifaire relevée le ${donnees.grille_tarifaire.releve_le} (${donnees.grille_tarifaire.unite}, ` +
      `${donnees.grille_tarifaire.devise}) · données collectées le ${fmtDateHeure(donnees.genere_le)} · ` +
      `source : ${donnees.source_donnees}` +
      (copieHorsLigne || navigator.onLine === false ? " · hors ligne : dernière copie connue" : "");
  }
  const sousTitre = document.getElementById("entete-sous-titre");
  if (sousTitre) {
    sousTitre.textContent = `Mis à jour le ${fmtDateHeure(donnees.genere_le)}${
      copieHorsLigne ? " · hors ligne" : ""
    }`;
  }
}

/* ------------------------------------------------------------- navigation */

function montrerOnglet(nom, options = {}) {
  const cible = ONGLETS.includes(nom) ? nom : "synthese";
  ONGLETS.forEach((cle) => {
    const vue = document.getElementById(`vue-${cle}`);
    const onglet = document.querySelector(`.onglet[data-onglet="${cle}"]`);
    const actif = cle === cible;
    if (vue) vue.hidden = !actif;
    if (onglet) onglet.setAttribute("aria-selected", actif ? "true" : "false");
  });
  if (options.defiler !== false) window.scrollTo({ top: 0, behavior: "auto" });
  if (options.memoire !== false && location.hash !== `#${cible}`) {
    history.replaceState(null, "", `#${cible}`);
  }
  if (options.vibration !== false && navigator.vibrate) navigator.vibrate(6);
}

function preparerNavigation() {
  document.querySelectorAll(".onglet").forEach((onglet) => {
    onglet.addEventListener("click", () => montrerOnglet(onglet.getAttribute("data-onglet")));
  });
  document.querySelectorAll("[data-aller]").forEach((bouton) => {
    bouton.addEventListener("click", () => montrerOnglet(bouton.getAttribute("data-aller")));
  });
  const pastille = document.getElementById("pastille-horaire");
  if (pastille) pastille.addEventListener("click", () => montrerOnglet("horaires"));

  document.querySelectorAll(".segment").forEach((segment) => {
    segment.addEventListener("click", () => {
      modeCouts = segment.getAttribute("data-mode");
      document.querySelectorAll(".segment").forEach((autre) => {
        const actif = autre === segment;
        autre.classList.toggle("actif", actif);
        autre.setAttribute("aria-selected", actif ? "true" : "false");
      });
      if (donnees && zoomJours) zoomJours.rafraichir();
    });
  });

  window.addEventListener("hashchange", () => montrerOnglet(location.hash.slice(1), { defiler: false, memoire: false }));

  let minuteurRedimensionnement = null;
  window.addEventListener("resize", () => {
    clearTimeout(minuteurRedimensionnement);
    minuteurRedimensionnement = setTimeout(() => {
      if (donnees && zoomJours) {
        zoomJours.rafraichir();
        zoomThermique.rafraichir();
        dessinerMiniJours();
        dessinerProfils(donnees.profils);
      }
    }, 200);
  });
}

/* -------------------------------------------- installation et mode hors ligne */

let inviteInstallation = null;

function applicationInstallee() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    window.navigator.standalone === true
  );
}

function afficherBoutonInstallation(texte) {
  const bouton = document.getElementById("bouton-installer");
  if (!bouton || applicationInstallee()) return;
  if (texte) bouton.textContent = texte;
  bouton.hidden = false;
}

function lancerInstallation() {
  const bouton = document.getElementById("bouton-installer");
  if (inviteInstallation) {
    inviteInstallation.prompt();
    inviteInstallation.userChoice.then(() => {
      inviteInstallation = null;
      if (bouton) bouton.hidden = true;
    });
    return;
  }
  // Safari / iOS : pas d'invite programmable, on donne la marche à suivre.
  window.alert(
    "Pour installer l'application :\n\n" +
      "• iPhone / iPad : bouton Partager, puis « Sur l'écran d'accueil ».\n" +
      "• Android (Chrome) : menu ⋮, puis « Ajouter à l'écran d'accueil »."
  );
}

function preparerInstallation() {
  const bouton = document.getElementById("bouton-installer");
  if (bouton) bouton.addEventListener("click", lancerInstallation);

  window.addEventListener("beforeinstallprompt", (evenement) => {
    evenement.preventDefault();
    inviteInstallation = evenement;
    afficherBoutonInstallation("Installer");
  });

  window.addEventListener("appinstalled", () => {
    inviteInstallation = null;
    if (bouton) bouton.hidden = true;
  });

  // iOS n'émet pas « beforeinstallprompt » : on propose la marche à suivre.
  const ua = navigator.userAgent || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) afficherBoutonInstallation("Installer");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* hors ligne indisponible : la page reste utilisable en ligne */
    });
  }
}

async function memoriserDonnees(reponse) {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open("suivi-deepseek-donnees-v2");
    await cache.put("data/suivi.json", reponse.clone());
  } catch (erreur) {
    /* stockage indisponible : la page reste utilisable en ligne */
  }
}

async function donneesEnCache() {
  if (!("caches" in window)) return null;
  try {
    const reponse = await caches.match("data/suivi.json");
    return reponse ? await reponse.json() : null;
  } catch (erreur) {
    return null;
  }
}

function afficherErreur(erreur) {
  const bandeau = document.getElementById("bandeau");
  if (!bandeau) return;
  bandeau.className = "bandeau erreur";
  bandeau.innerHTML = navigator.onLine
    ? `Données indisponibles (${erreur.message}). Lancez <code>python3 outils/collecter.py</code> à la racine du ` +
      "projet, puis appuyez sur ⟳."
    : "Hors ligne : aucune copie des statistiques n'est encore enregistrée sur cet appareil. " +
      "Reconnectez-vous une fois pour l'activer.";
}

async function chargerDonnees() {
  try {
    const reponse = await fetch("data/suivi.json", { cache: "no-store" });
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    await memoriserDonnees(reponse);
    copieHorsLigne = false;
    return await reponse.json();
  } catch (erreur) {
    // Application installée et consultée hors ligne : on réaffiche la
    // dernière copie connue, en le signalant explicitement dans le pied de page.
    const enCache = await donneesEnCache();
    if (!enCache) {
      afficherErreur(erreur);
      return null;
    }
    copieHorsLigne = true;
    return enCache;
  }
}

async function actualiser(vibration) {
  const contenu = await chargerDonnees();
  if (!contenu) return;
  donnees = contenu;
  joursFeries = new Set(donnees.regle_horaires.jours_feries_chinois || []);
  rendreHorloge();
  rendreTout();
  if (vibration && navigator.vibrate) navigator.vibrate(12);
}

function preparerRafraichissement() {
  const bouton = document.getElementById("bouton-rafraichir");
  if (bouton) {
    bouton.addEventListener("click", async () => {
      bouton.textContent = "…";
      await actualiser(true);
      bouton.textContent = "⟳";
    });
  }
  if (!minuteurHorloge) minuteurHorloge = setInterval(rendreHorloge, 1000);
  if (!minuteurRafraichissement) {
    minuteurRafraichissement = setInterval(async () => {
      const contenu = await chargerDonnees();
      if (contenu) {
        donnees = contenu;
        rendreTout();
      }
    }, 60000);
  }
}

async function demarrer() {
  await actualiser(false);
  if (!donnees) return;
  preparerZooms();
  rendreHorloge();
  rendreTout();
  preparerRafraichissement();
}

document.addEventListener("DOMContentLoaded", () => {
  preparerInstallation();
  preparerNavigation();
  montrerOnglet(location.hash.slice(1), { defiler: false, memoire: false, vibration: false });
  demarrer();
});
