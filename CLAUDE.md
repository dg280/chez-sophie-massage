# Chez Sophie Massage Tuina — Memoire projet

Site vitrine + booking pour Sophie, praticienne chinoise de massage Tuina a La Teste-de-Buch (Bassin d'Arcachon).

## URLs

- **Production** : https://www.sophie-tuina.fr (alias de chez-sophie-massage.vercel.app)
- **Repo GitHub** : https://github.com/dg280/chez-sophie-massage
- **Vercel project** : kadabras-projects-6145d937/chez-sophie-massage
- **Email Sophie** : zhengyajie68@gmail.com

## Stack

100% statique HTML/CSS/JS + 4 fonctions serverless Vercel. **Zero base de donnees.**

- **Hosting** : Vercel (deploiement manuel via `npx vercel --prod`, pas de webhook auto GitHub)
- **Service email** : MailerSend (compte avec un domaine verifie deja existant — non `sophie-tuina.fr`, et critique, donc on n'y touche pas)
- **Persistance "soft"** : `tarifs.json` et `planning.json` sont stockes dans le repo GitHub et editables via l'admin (commits faits via l'API GitHub Contents avec un PAT)

## Architecture

```
/                       Page d'accueil (hero, soins, avis, booking, contact)
/mon-histoire           Storytelling Sophie en 4 actes (SEO + retention)
/soins/massage-tuina    Page detail SEO (signature service)
/soins/massage-relaxant Page detail SEO (gros volume de recherche)
/soins/moxibustion      Page detail SEO (niche premium)
/admin.html             Interface admin (mot de passe, noindex)
/api/booking            POST — recoit demande de RDV, envoie email Sophie
/api/confirm            GET — Sophie clique "Confirmer" -> bloque le creneau
/api/refuse             GET — Sophie clique "Refuser" -> email poli au client
/api/reviews            GET — proxy Google Places API (pas encore active)
/sitemap.xml            Sitemap pour Google
/robots.txt             Bloque /admin.html et /api/
/tarifs.json            Soins + tarifs (edite via admin)
/planning.json          Conges, jours fermes, creneaux bloques (edite via admin)
/panda.webp             Photo accueil (rognee a 470x707 pour eviter bandes noires)
```

## Variables d'environnement Vercel (production)

```
MAILERSEND_API_KEY      Cle API MailerSend
SOPHIE_EMAIL            Email destinataire des demandes RDV
FROM_EMAIL              Adresse expediteur sur le domaine MailerSend verifie
FROM_NAME               Nom expediteur (ex "Chez Sophie - Massage Tuina")
BOOKING_SECRET          Secret HMAC pour signer les tokens de confirmation
GITHUB_TOKEN            PAT fine-grained avec permission Contents:R+W sur le repo
GITHUB_OWNER            "dg280" (defaut)
GITHUB_REPO             "chez-sophie-massage" (defaut)
GOOGLE_PLACES_API_KEY   (optionnel) Pour /api/reviews — pas encore active
GOOGLE_PLACE_ID         (optionnel) ID de la fiche Google Business
```

## Flow de reservation

1. Client soumet le formulaire → **POST /api/booking**
2. L'API valide les champs, signe un token HMAC contenant toute la demande (validite 7 jours)
3. Email envoye a Sophie avec 2 boutons : Confirmer (`/api/confirm?token=...`) et Refuser (`/api/refuse?token=...`)
4. Email d'accuse de reception envoye au client immediatement
5. Sophie clique :
   - **Confirmer** → l'API verifie le HMAC, ajoute le creneau dans `planning.json` via l'API GitHub, envoie email de confirmation au client, affiche page "RDV confirme" a Sophie
   - **Refuser** → l'API verifie le HMAC, envoie email poli au client, le creneau reste libre
6. Le creneau bloque dans `planning.json` n'est plus propose aux autres visiteurs

## Securite admin

- **Mot de passe** stocke en hash SHA-256 dans localStorage (jamais dans le code)
- **Token GitHub** chiffre en AES-GCM avec le mot de passe admin (PBKDF2 100k iterations)
- **Anti-bruteforce** : 5 tentatives max, lockout 5 min
- **Session** auto-expirable apres 30 min d'inactivite
- **Mot de passe initial** : `sophie2026` (a changer a la premiere connexion via l'onglet Securite)

## Branches actives

- `main` : production
- `seo-soins-pages` : pages SEO en cours de validation (Tuina, Relaxant, Moxibustion)

## Tests

```bash
npm test
```

40 tests de non-regression sur les endpoints email :
- `tests/booking.test.js` : validation, signature HMAC, envoi MailerSend, accuse client
- `tests/confirm.test.js` : verification HMAC, expiration, mise a jour planning.json, idempotence
- `tests/refuse.test.js` : verification HMAC, email refus, garantie qu'aucun creneau n'est bloque

Les tests **mockent `globalThis.fetch`** et l'environnement — aucun appel reseau reel.

## Commandes utiles

```bash
# Dev local avec clean URLs (comme en prod)
npx vercel dev --listen 3000

# Deploiement production
npx vercel --prod

# Tests
npm test

# Push (pas de webhook auto Vercel — penser au deploy apres push)
git push origin main && npx vercel --prod
```

## Conventions importantes

- **Pas de framework** : tout en HTML/CSS/JS vanilla. Eviter d'introduire React, Vue, etc.
- **Style Sophie a la 1ere personne** dans les pages soins : ton humain, anti-IA, eviter le jargon SEO surfait
- **`tarifs.json` est la source de verite** des soins. L'admin l'edite. `index.html` a un fallback embarque pour eviter une page vide si le fetch echoue
- **Sophie est chinoise**, arrivee en France en 2011. Argument SEO + branding fort
- **Pas de Google Analytics** ni de tracker — respecter la confidentialite
- **Note Google : 5,0 / 205 avis** (en dur dans le HTML, override possible via /api/reviews)

## Choses a savoir sur le contenu

- La photo `panda.webp` est la **statue panda devant le cabinet**, pas une photo de Sophie. Elle est utilisee en accueil
- Une **vraie photo de Sophie** est attendue mais pas encore fournie. La page `/mon-histoire` charge `sophie.{jpg,png,webp}` depuis GitHub raw, avec un placeholder en attendant. Editable via l'admin (onglet Visuels)
- Le mot de passe par defaut est dans le code mais sera hashe a la premiere connexion

## Pieges connus

- **Vercel ne se redeploye PAS automatiquement** sur push GitHub — il faut lancer `npx vercel --prod` apres chaque push
- Les pushes via l'admin (commits sur tarifs.json/planning.json) peuvent causer des conflits si tu codes en local — toujours `git pull --rebase` avant de push
- Le `vercel.json` doit avoir `cleanUrls: true` pour les URLs sans `.html`
- Sur l'admin, le token MailerSend n'est PAS le meme que le token GitHub — ne pas confondre
