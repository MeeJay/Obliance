# Import de la documentation Obliance dans BookStack

Ce dossier contient un jeu de pages Markdown pretes a importer dans une
etagere BookStack dediee ("Obliance"), plus un script d'import.

## Etat actuel du contenu (genere partiellement)

La generation complete (3 livres, 23 chapitres) a ete interrompue par la
limite de session du compte utilise pour la generer — pas un probleme du
script d'import. **8 chapitres sur 23** ont ete generes et sont prets ici.
Voir la conversation d'origine pour la liste exacte des chapitres restants ;
`manifest.json` ne contient que les chapitres effectivement generes, donc
l'import fonctionne des maintenant avec un livre partiel. Relancer la
generation plus tard puis relancer `import.js` completera les livres sans
dupliquer ce qui a deja ete importe (voir "Idempotence" plus bas).

## Structure

```
docs-import/
├── manifest.json     # Description de l'etagere / livres / chapitres / pages
├── content/
│   └── <livre>/<chapitre>/<page>.md
├── import.js         # Script d'import (Node.js 18+)
└── README.md          # Ce fichier
```

## Securite du script d'import

Lis `import.js` avant de l'executer — il est volontairement court et lisible.
Points cles :

- **Dry-run par defaut.** Sans `--apply`, le script n'effectue que des
  requetes `GET` (lecture) et affiche uniquement ce qu'il *ferait*. Rien
  n'est cree.
- **Aucune fonction de suppression n'existe dans le fichier.** Il ne peut
  pas supprimer un livre, un chapitre ou une page sur ton BookStack, meme
  par erreur — le code pour le faire n'y est pas.
- **Create-only.** Les seules requetes d'ecriture sont des `POST` de
  creation (livre/chapitre/page/etagere) et un `PUT` limite a l'attachement
  des livres a l'etagere.
- **Idempotent.** Chaque objet cree est note dans
  `.bookstack-import-state.json` (cree a cote de ce script au premier
  `--apply`). Relancer le script ignore ce qui a deja ete cree au lieu de
  le dupliquer.
- **Ne touche jamais un objet existant qu'il n'a pas cree lui-meme.** Si un
  livre ou une etagere du meme nom existe deja sur ton BookStack sans
  figurer dans `.bookstack-import-state.json`, le script s'arrete avec un
  message d'erreur plutot que d'y toucher a l'aveugle. Il faut passer
  explicitement `--force-reuse` pour l'autoriser a reutiliser cet objet
  existant (aucune modification destructive n'est faite dessus pour autant).

## Obtenir un jeton API BookStack

1. Connecte-toi a BookStack avec un compte administrateur.
2. Menu utilisateur (en haut a droite) > **Mon profil**.
3. Onglet **Jetons API** > **Creer un jeton**.
4. Note l'**ID du jeton** et le **secret** affiches (le secret n'est visible
   qu'une seule fois).

## Utilisation

```bash
# 1. Variables d'environnement (ne pas les committer)
export BOOKSTACK_URL="https://doc.exemple.com"
export BOOKSTACK_TOKEN_ID="xxxxxxxxxxxxxxxxxxxxxxxx"
export BOOKSTACK_TOKEN_SECRET="xxxxxxxxxxxxxxxxxxxxxxxx"

# 2. Verifier le plan sans rien creer
node import.js

# 3. Une fois le plan relu et valide, creer reellement le contenu
node import.js --apply
```

Sous PowerShell, remplace `export VAR="valeur"` par `$env:VAR = "valeur"`.

## Completer la documentation plus tard

Quand les chapitres manquants seront generes, il suffira d'ajouter leurs
pages dans `content/<livre>/<chapitre>/` et de mettre a jour
`manifest.json` en consequence, puis de relancer `node import.js --apply` :
seuls les nouveaux chapitres/pages seront crees, l'existant restera
inchange.
