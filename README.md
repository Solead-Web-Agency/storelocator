# Store locator PCS

Carte des points de vente PCS (recharges et cartes), en site statique, prévue pour être intégrée
en iframe dans Webflow.

- Aucun build : `index.html` + `assets/app.css` + `assets/app.js` + `data/stores.json`.
- Deux langues : `/` en français, `/en/` en anglais. Les deux pages partagent le même script et le même CSS ;
  la langue est lue sur la balise `<script data-lang="en" data-base="../">`. Les textes JS sont dans la table
  `I18N` de `assets/app.js`, les textes HTML dans chaque `index.html` (à garder synchronisés).
- Carte : [MapLibre GL](https://maplibre.org/) avec le fond clair « positron » d'[OpenFreeMap](https://openfreemap.org/) (gratuit, sans clé).
- Recherche : géocodeur adresses de l'État (Géoplateforme IGN, repli sur l'API Adresse BAN), gratuit et sans clé.
- Regroupement automatique des 28 000 points en clusters. La liste ne montre que les 10 points de vente visibles
  les plus proches de la recherche (ou du centre de la carte) ; la carte, elle, les affiche tous (`maxResults` dans `CONFIG`).

## Mettre à jour les données

1. Déposer le nouvel export à la racine, nommé `PCS_liste store_AAAAMMJJ.csv` (colonnes attendues :
   `ID, Infos, Type, Nom, Prénom et Nom, Adresse, Code postal, Ville, Pays, Longitude, Latitude, Ambassadeur`).
2. Lancer :

   ```bash
   python3 scripts/build_data.py
   ```

   Le script prend le fichier le plus récent, ignore les lignes sans coordonnées et régénère `data/stores.json`.
   Le type de service est déduit de la colonne `Infos` (« Cartes et recharges… » → vente de carte).

## Tester en local

```bash
python3 -m http.server 8080
```

Puis ouvrir http://localhost:8080/ (le fichier `stores.json` doit être servi en HTTP, pas ouvert en `file://`).

## Déployer

Le site est 100 % statique : GitHub Pages, Netlify, Vercel ou n'importe quel hébergeur convient.
Avec GitHub Pages : Settings → Pages → Source « Deploy from a branch », branche `main`, dossier `/ (root)`.

## Intégrer dans Webflow

Ajouter un élément **Embed** (code HTML) dans la page Webflow :

```html
<iframe
  src="https://VOTRE-DOMAINE/storelocator/"
  title="Trouver une boutique PCS"
  style="width:100%;height:80vh;min-height:600px;border:0;display:block"
  loading="lazy"
  allow="geolocation"
  referrerpolicy="strict-origin-when-cross-origin"></iframe>
```

- La hauteur de l'iframe fixe la hauteur de l'application : la liste défile à l'intérieur.
- `allow="geolocation"` est nécessaire pour le bouton « Autour de moi ».
- Version anglaise : même iframe avec `src="https://VOTRE-DOMAINE/storelocator/en/"`.
- On peut pré-remplir une recherche : `.../storelocator/?q=Lyon`.
- Le bouton « Ouvrir un compte » s'ouvre dans la page parente (`target="_top"`).
- La molette seule fait défiler la page Webflow ; Ctrl/⌘ + molette zoome la carte (deux doigts sur mobile).
  Désactivable avec `cooperativeGestures: false` dans `CONFIG`.
- L'application expose `window.storeLocator` (`map`, `search(q)`, `select(id)`) pour un pilotage éventuel.

## Tracking (postMessage vers la page parente)

L'app n'embarque ni GTM ni `dataLayer`. À chaque recherche et à chaque sélection, elle envoie un
`postMessage` à la page parente, qui le pousse dans son `dataLayer` :

```js
{ source: "pcs-store-locator", event: "store_locator_search", event_data: { search_method, search_term, search_status } }
{ source: "pcs-store-locator", event: "store_locator_select", event_data: { store_name, store_city, selection_method } }
```

- `search_method` : `code_postal` (saisie de 4 ou 5 chiffres), `ville` (autre saisie ou suggestion), `geolocalisation`.
- `search_term` : le code postal tel quel, la ville normalisée (`saint_etienne`), ou la chaîne `geolocalisation`.
- `search_status` : `succes` (≥ 1 point de vente listé), `aucun_resultat` (0 point de vente, ou adresse non reconnue),
  `erreur` (géocodeur injoignable, géolocalisation refusée ou indisponible).
- `store_name` : colonne `Nom` de l'export, normalisée (`pcs_store` tant que l'export ne contient pas de nom propre).
- `store_city` : colonne `Ville` de l'export, sans numéro d'arrondissement, normalisée (`paris`, `lyon`).
- `selection_method` : `liste` (bouton d'une carte de la liste) ou `carte` (clic sur un marqueur).
- Pas de doublon : une recherche identique à la précédente (même méthode, terme et statut) n'est pas renvoyée ;
  une re-sélection du même point de vente dans les 2 secondes non plus.
- Hors iframe, rien n'est envoyé. Avec `?debug=1` dans l'URL, les événements sont aussi affichés en `console.debug`.
- Les recherches lancées par `?q=` ou par `window.storeLocator.search()` sont trackées ; les sélections faites par
  `window.storeLocator.select()` ne le sont pas (uniquement les clics utilisateur).

URL de production stable de l'app : https://storelocator-alpha.vercel.app (alias Vercel du projet ; les URL
`storelocator-xxxx-solead-agency.vercel.app` changent à chaque déploiement). C'est celle-ci que l'iframe Webflow
et le filtre d'origine du listener parent doivent utiliser.

## Personnaliser

- Textes et URL « Ouvrir un compte » par langue : table `I18N` ; zooms, couleurs des pins : objet `CONFIG`, en tête de `assets/app.js`.
- Couleurs, polices, rayons : variables `:root` en tête de `assets/app.css`.
- Libellés des boutons des cartes : dans le `<template id="tpl-card">` de `index.html` et `en/index.html`.
