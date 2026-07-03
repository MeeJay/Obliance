# Importer un scÃ©nario

L'import d'un fichier JSON crÃ©e un nouveau scÃ©nario dans le tenant courant, en gÃ©rant automatiquement les conflits avec les scripts dÃ©jÃ  prÃ©sents.

## Permissions requises

L'import nÃ©cessite la permission de gestion des scripts (capacitÃ© `scripts.manage`) sur l'Ã©quipe de l'utilisateur ; les administrateurs y ont accÃ¨s sans configuration supplÃ©mentaire.

## ProcÃ©dure d'import unitaire

1. Ouvrez **Automations** (`/schedules`) â†’ onglet **ScÃ©narios**.
2. Cliquez sur **Â« Import JSON Â»** dans la barre d'outils (Â« Import a scenario JSON file (with or without embedded scripts) Â»).
3. SÃ©lectionnez le fichier `.json` exportÃ© prÃ©cÃ©demment (lean ou with scripts, les deux formats sont acceptÃ©s).
4. Obliance analyse le fichier et affiche un aperÃ§u des conflits Ã©ventuels avant tout enregistrement.
5. Pour chaque script en conflit (un script du fichier dont l'identifiant unique existe dÃ©jÃ  dans le tenant cible), choisissez une stratÃ©gie :

| StratÃ©gie | Effet |
|---|---|
| Skip (ignorer) | Le script existant dans le tenant est conservÃ© tel quel, le scÃ©nario importÃ© s'y raccroche |
| Overwrite (Ã©craser) | Le contenu du script existant est remplacÃ© par celui du fichier importÃ© |
| New (nouvelle copie) | Un nouveau script est crÃ©Ã© avec un nouvel identifiant, renommÃ© Â« `<nom> (imported)` Â» |

6. Validez : l'import est appliquÃ© en une seule opÃ©ration (tout ou rien).

## Comportement automatique aprÃ¨s import

Deux rÃ©glages sont volontairement remis Ã  zÃ©ro pour Ã©viter tout effet de bord sur un tenant qui n'a pas encore validÃ© le scÃ©nario :

- **Statut** : le scÃ©nario importÃ© arrive toujours au statut **draft** (brouillon), quel que soit son statut au moment de l'export. Il ne se dÃ©clenchera pas tant qu'il n'a pas Ã©tÃ© activÃ© manuellement.
- **Cibles** : la liste d'appareils cibles est vidÃ©e (le scÃ©nario repasse en mode Â« target Â» sans aucune cible), car les identifiants d'appareils de l'installation source n'ont aucun sens dans le tenant de destination. SÃ©lectionnez Ã  nouveau les appareils ou groupes concernÃ©s avant d'activer le scÃ©nario.

## En cas de fichier invalide

Si le fichier JSON contient une erreur de structure â€” identifiant d'Ã©tape dupliquÃ©, type d'Ã©tape inconnu, liaison pointant vers une Ã©tape inexistante, absence de tout dÃ©clencheur, Ã©tape d'exÃ©cution de script sans rÃ©fÃ©rence de script, script sans nom ou sans contenu â€” l'import est rejetÃ© avant tout enregistrement, avec un message listant chaque problÃ¨me rencontrÃ©. C'est le cas le plus frÃ©quent avec un scÃ©nario gÃ©nÃ©rÃ© par une IA Ã  partir du modÃ¨le vide : relisez le message d'erreur, corrigez le fichier, puis relancez l'import.