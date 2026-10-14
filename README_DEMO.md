# PharmaGest — Démonstration (GitHub Pages)

Version de démonstration **pour téléphone** : les clients ouvrent un lien, choisissent **Administrateur** ou **Vendeur**, et essaient l'application avec des données fictives (24 produits, lots, péremptions, alertes de stock, ventes, rapports).

Aucun serveur : tout tourne dans le navigateur du visiteur et ses données restent sur son appareil.

## Publier sur GitHub (gratuit)
1. Sur github.com, créez un dépôt **public** (par ex. `pharmagest-demo`).
2. Envoyez **le contenu** de ce dossier à la racine du dépôt : `index.html`, le dossier `app/` (et `.nojekyll` si possible). `index.html` doit se trouver à la racine, pas dans un sous-dossier.
3. Dépôt → **Settings → Pages** → *Build and deployment* → Source : **Deploy from a branch** → Branch : `main` et dossier `/ (root)` → **Save**.
4. Après 1 à 2 minutes, le lien est : `https://VOTRE-COMPTE.github.io/pharmagest-demo/`

Astuce : générez un QR code de ce lien pour le montrer au client. Sur iPhone : Partager → « Sur l'écran d'accueil » ; sur Android : menu ⋮ → « Installer l'application ».

## Utilisation
- Comptes : `admin` et `vendeur`, mot de passe `demo1234` (la page d'accueil de la démo les ouvre en un toucher).
- La pastille **DÉMO · rôle · changer** (en bas à gauche) ramène au choix du rôle.
- **Réinitialiser la démonstration** (page d'accueil) efface les données et les recrée.

## Ce que la démo ne contient pas
Ces fonctions demandent le téléphone Android (non disponibles dans un navigateur) et sont masquées : réseau Wi-Fi Admin/vendeurs et QR d'appairage, synchronisation, sauvegarde Google Drive, notifications en arrière-plan.

## Contenu technique
- `index.html` : page d'accueil de la démo (crée les données fictives au premier lancement).
- `app/` : l'application PharmaGest Android V69 (pages web), avec `assets/js/demo-guard.js` (retour à l'accueil sans session, pastille DÉMO, masquage des fonctions Android) et sans service worker.
- Tout est modifiable : produits et ventes d'exemple dans le script de `index.html`.
