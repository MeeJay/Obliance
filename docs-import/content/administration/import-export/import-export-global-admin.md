Le module **Import/Export** du menu admin permet d'exporter et de reimporter en bloc plusieurs categories de configuration de l'installation Obliance.

## Acces

Menu admin **Import/Export**. Cette page est reservee aux comptes ayant le role administrateur.

## Sections concernees

L'export/import global couvre les categories suivantes :

- Groupes d'appareils
- Parametres (settings)
- Canaux de notification
- Teams
- Actions de remediation
- Bindings de remediation (associations action <-> declencheur)

Ce module ne couvre **pas** les scripts, les schedules ni les scenarios : ces elements ont leur propre mecanisme d'export, decrit dans la page "Export et import de scenarios".

## Exporter

1. Ouvrez **Import/Export** dans le menu admin.
2. Selectionnez les sections a inclure dans l'export.
3. Si vous avez des actions de remediation utilisant des identifiants SSH, activez ou non la case **Include SSH credentials** â€” elle est **desactivee par defaut**, ce qui exclut les identifiants SSH du fichier exporte par securite.
4. Lancez le telechargement du fichier JSON d'export.

### Protection automatique des secrets

Lors de l'export, les champs sensibles des canaux de notification (URL de webhook, cle API, jeton, mot de passe, secret, etc.) sont automatiquement remplaces par une valeur masquee dans le fichier exporte. Il n'est donc pas necessaire de nettoyer manuellement le fichier avant de le partager avec un tiers pour relecture â€” les secrets de notification ne s'y trouvent pas en clair. Les identifiants SSH des actions de remediation suivent une regle separee : ils ne sont inclus que si la case **Include SSH credentials** a ete cochee explicitement au moment de l'export.

## Importer

1. Ouvrez **Import/Export** dans le menu admin.
2. Dans la zone d'import, deposez ou selectionnez le fichier `.json` a importer.
3. Pour chaque element dont l'identifiant existe deja dans la base, choisissez une strategie de conflit parmi trois options :

| Strategie | Effet |
|---|---|
| **Mettre a jour l'existant** | L'element existant est ecrase par la version du fichier importe |
| **Creer une copie (nouvel identifiant)** | Un nouvel element est cree avec un nouvel identifiant, l'existant n'est pas touche |
| **Ignorer** | L'element du fichier est ignore, l'existant est conserve tel quel |

4. Validez l'import.

### Gestion des collisions entre tenants

Si un identifiant importe existe deja mais dans un **autre tenant** que celui vise par l'import, Obliance ne fusionne jamais silencieusement les deux : un nouvel identifiant est genere automatiquement pour l'element importe, evitant tout melange de donnees entre tenants.

## Limitations connues

- Les libelles de section affiches dans l'interface (notamment ceux lies aux groupes d'appareils) peuvent ne pas correspondre exactement aux categories reellement traitees cote serveur sur la version actuelle. Si une section semble vide ou ne pas se filtrer comme attendu lors d'un import, verifiez le contenu du fichier JSON brut avant de conclure a une perte de donnees.
- Comme indique dans la page de vue d'ensemble, la version actuelle presente un dysfonctionnement empechant l'export ou l'import de fonctionner correctement. Tant que ce point n'est pas confirme resolu par le support/l'equipe technique sur votre version, ne considerez pas ce module comme fiable pour une sauvegarde de production.

> Build a lancer : aucun (documentation uniquement)