# Store locator PCS

Carte des points de vente PCS (recharges et cartes), en site statique, prévue pour être intégrée
en iframe dans Webflow.

- Aucun build : `index.html` + `assets/app.css` + `assets/app.js` + `data/stores.json`.
- Carte : [MapLibre GL](https://maplibre.org/) avec le fond clair « positron » d'[OpenFreeMap](https://openfreemap.org/) (gratuit, sans clé).
- Recherche : géocodeur adresses de l'État (Géoplateforme IGN, repli sur l'API Adresse BAN), gratuit et sans clé.
- Regroupement automatique des 28 000 points en clusters, liste des boutiques triée par distance.

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
- On peut pré-remplir une recherche : `.../storelocator/?q=Lyon`.
- Le bouton « Ouvrir un compte » s'ouvre dans la page parente (`target="_top"`).
- La molette seule fait défiler la page Webflow ; Ctrl/⌘ + molette zoome la carte (deux doigts sur mobile).
  Désactivable avec `cooperativeGestures: false` dans `CONFIG`.
- L'application expose `window.storeLocator` (`map`, `search(q)`, `select(id)`) pour un pilotage éventuel.

## Personnaliser

- Textes, URL « Ouvrir un compte », zooms, couleurs des pins : objet `CONFIG` en tête de `assets/app.js`.
- Couleurs, polices, rayons : variables `:root` en tête de `assets/app.css`.
- Libellés des boutons des cartes : dans le `<template id="tpl-card">` de `index.html`.
