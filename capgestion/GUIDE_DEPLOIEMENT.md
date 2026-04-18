# Guide de déploiement CAPGestion
## Du code à l'application en ligne — étape par étape

---

## Ce dont vous avez besoin

- Un ordinateur avec connexion internet
- 30 à 45 minutes
- Une adresse email

---

## ÉTAPE 1 — Créer un compte GitHub (gratuit)

GitHub est l'endroit où votre code sera stocké.

1. Allez sur https://github.com
2. Cliquez "Sign up"
3. Créez votre compte avec votre email
4. Vérifiez votre email et connectez-vous

---

## ÉTAPE 2 — Installer Git sur votre ordinateur

### Sur Windows
1. Allez sur https://git-scm.com/download/win
2. Téléchargez et installez (tout laisser par défaut)
3. Ouvrez "Git Bash" (installé avec Git)

### Sur Mac
1. Ouvrez le Terminal
2. Tapez : `git --version`
3. Si non installé, suivez les instructions à l'écran

---

## ÉTAPE 3 — Mettre le code sur GitHub

Ouvrez Git Bash (Windows) ou Terminal (Mac) et tapez :

```bash
# Allez dans le dossier du projet
cd "C:\Users\elise\OneDrive\Documents\Travaux IA\capgestion_v1\capgestion"

# Initialisez Git
git init
git add .
git commit -m "Version initiale CAPGestion"

# Créez un dépôt sur GitHub
# (Allez sur github.com → New repository → Nom: capgestion → Create)
# Puis copiez l'URL donnée et tapez :

git remote add origin https://github.com/vagnysevenbrain-png/capgestion
git branch -M main
git push -u origin main
```

---

## ÉTAPE 4 — Créer un compte Render (gratuit)

Render est la plateforme qui va héberger votre application.

1. Allez sur https://render.com
2. Cliquez "Get Started for Free"
3. Connectez-vous avec votre compte GitHub
4. Autorisez Render à accéder à vos dépôts

---

## ÉTAPE 5 — Créer la base de données PostgreSQL

1. Dans Render, cliquez "New +" → "PostgreSQL"
2. Remplissez :
   - Name : `capgestion-db`
   - Region : `Frankfurt (EU Central)` (le plus proche d'Abidjan)
   - Plan : **Free**
3. Cliquez "Create Database"
4. Attendez 1-2 minutes
5. **Copiez l'URL** intitulée "Internal Database URL" — vous en aurez besoin :postgresql://capgestion_db_user:4aigM2HdnRsaZOkEqu6jpFXq2fk9Wjh9@dpg-d7hqupfavr4c73f8pj60-a/capgestion_db

---

## ÉTAPE 6 — Initialiser la base de données

1. Dans Render, allez dans votre base de données
2. Cliquez "Connect" → "PSQL Command"
3. Copiez cette commande et exécutez-la dans votre terminal
4. Dans le terminal psql qui s'ouvre, copiez-collez
   tout le contenu du fichier `backend/db/schema.sql`
5. Appuyez sur Entrée
6. Tapez `\q` pour quitter

---

## ÉTAPE 7 — Déployer l'application

1. Dans Render, cliquez "New +" → "Web Service"
2. Sélectionnez votre dépôt `capgestion`
3. Remplissez :
   - Name : `capgestion`
   - Region : `Frankfurt (EU Central)`
   - Branch : `main`
   - Root Directory : `backend`
   - Runtime : `Node`
   - Build Command : `npm install`
   - Start Command : `npm start`
   - Plan : **Free**

4. Faites défiler jusqu'à "Environment Variables" et ajoutez :

   | Clé | Valeur |
   |-----|--------|
   | `DATABASE_URL` | (l'URL copiée à l'étape 5) |
   | `SESSION_SECRET` | (une phrase longue aléatoire, ex: `capgestion_abidjan_2026_secret_xk92p`) |
   | `NODE_ENV` | `production` |

5. Cliquez "Create Web Service"
6. Attendez 3-5 minutes — Render installe et démarre l'application

---

## ÉTAPE 8 — Accéder à votre application

1. Render vous donne une URL du type : `https://capgestion.onrender.com`
2. Ouvrez cette URL dans votre navigateur
3. Vous verrez la page de connexion CAPGestion

---

## ÉTAPE 9 — Créer vos vrais mots de passe

Le schéma SQL a créé deux comptes avec des mots de passe temporaires.
Il faut les remplacer par de vrais mots de passe hashés.

Dans votre terminal (dossier backend), tapez :

```bash
node -e "
const bcrypt = require('bcrypt');
bcrypt.hash('VOTRE_MOT_DE_PASSE_PROPRIETAIRE', 10).then(h => console.log('Propriétaire:', h));
bcrypt.hash('VOTRE_MOT_DE_PASSE_GERANTE', 10).then(h => console.log('Gérante:', h));
"
```

Copiez les deux hash générés, puis mettez-les à jour dans la base :

```sql
UPDATE utilisateurs
SET mot_de_passe = 'HASH_COPIE_ICI'
WHERE email = 'patron@capgestion.ci';

UPDATE utilisateurs
SET mot_de_passe = 'HASH_COPIE_ICI'
WHERE email = 'angele@capgestion.ci';
```

---

## ÉTAPE 10 — Tester votre application

1. Allez sur votre URL Render
2. Connectez-vous avec `patron@capgestion.ci` et votre mot de passe
3. Vérifiez que tout fonctionne
4. Testez ensuite le compte gérante

---

## Mise à jour du logiciel (pour les futures améliorations)

Chaque fois que vous modifiez le code, il suffit de faire :

```bash
git add .
git commit -m "Description de la modification"
git push
```

Render détecte automatiquement le push et redéploie en 2-3 minutes.

---

## Coûts

| Service | Coût mensuel |
|---------|-------------|
| Render Web Service (Free) | 0 FCFA |
| Render PostgreSQL (Free) | 0 FCFA |
| **Total démarrage** | **0 FCFA** |

> Note : le plan gratuit de Render met l'application en veille après 15 min
> d'inactivité. Le premier accès prend ~30 secondes. Pour éviter ça,
> passez au plan "Starter" à ~5 000 FCFA/mois quand votre business grandit.

---

## En cas de problème

Consultez les logs dans Render → votre service → "Logs".
Les erreurs courantes y sont clairement indiquées.

Pour toute question, revenez vers moi avec le message d'erreur exact.
