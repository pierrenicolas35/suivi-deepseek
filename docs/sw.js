/* Service worker « Suivi DeepSeek » : rend l'application installable et
   consultable hors ligne (toutes les pages d'analyse). Les statistiques (data/suivi.json) restent servies par le réseau
   en priorité, pour ne jamais afficher des chiffres périmés sans le dire. */
"use strict";

const COQUILLE = "suivi-deepseek-coquille-v3"; // page, styles, script, icônes
const DONNEES = "suivi-deepseek-donnees-v3"; // dernière copie des statistiques
const FICHIERS_COQUILLE = [
  "./",
  "./index.html",
  "./couts.html",
  "./horaires.html",
  "./repartition.html",
  "./demandes.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icone-192.png",
  "./icone-512.png",
];

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    caches
      .open(COQUILLE)
      .then((cache) => cache.addAll(FICHIERS_COQUILLE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      .then((cles) =>
        Promise.all(
          cles
            .filter((cle) => cle.startsWith("suivi-deepseek-coquille-") && cle !== COQUILLE)
            .map((cle) => caches.delete(cle))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function reseauPuisCache(requete, nomCache) {
  try {
    const reponse = await fetch(requete);
    if (reponse && reponse.ok) {
      const copie = reponse.clone();
      const cache = await caches.open(nomCache);
      await cache.put(requete, copie);
    }
    return reponse;
  } catch (erreur) {
    const enCache = await caches.match(requete);
    if (enCache) return enCache;
    if (requete.mode === "navigate") {
      const page = await caches.match("./index.html");
      if (page) return page;
    }
    throw erreur;
  }
}

async function cachePuisReseau(requete) {
  const enCache = await caches.match(requete);
  if (enCache) return enCache;
  const reponse = await fetch(requete);
  if (reponse && reponse.ok) {
    const copie = reponse.clone();
    const cache = await caches.open(COQUILLE);
    await cache.put(requete, copie);
  }
  return reponse;
}

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  if (requete.method !== "GET") return;

  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;

  // Statistiques : réseau d'abord, copie conservée pour le mode hors ligne.
  if (url.pathname.endsWith("/data/suivi.json")) {
    evenement.respondWith(reseauPuisCache(requete, DONNEES));
    return;
  }

  // Page : réseau d'abord pour récupérer les mises à jour, repli sur la copie.
  if (requete.mode === "navigate") {
    evenement.respondWith(reseauPuisCache(requete, COQUILLE));
    return;
  }

  // Icônes : elles ne changent pas, la copie locale suffit.
  if (/\/icone-.*\.png$/.test(url.pathname)) {
    evenement.respondWith(cachePuisReseau(requete));
    return;
  }

  // Styles, script, manifeste : réseau d'abord aussi. Un « cache d'abord »
  // figerait la page sur une ancienne version après chaque déploiement.
  evenement.respondWith(reseauPuisCache(requete, COQUILLE));
});
